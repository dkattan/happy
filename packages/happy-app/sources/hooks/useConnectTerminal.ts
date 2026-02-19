import * as React from 'react';
import { Platform } from 'react-native';
import { CameraView } from 'expo-camera';
import { useAuth } from '@/auth/AuthContext';
import { decodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { authApprove } from '@/auth/authApprove';
import { authAccountApprove } from '@/auth/authAccountApprove';
import { useCheckScannerPermissions } from '@/hooks/useCheckCameraPermissions';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sync } from '@/sync/sync';

interface UseConnectTerminalOptions {
    onSuccess?: () => void;
    onError?: (error: any) => void;
}

type HappyAuthUrlKind = 'terminal' | 'account';

function getAuthUrlKind(url: string): HappyAuthUrlKind | null {
    if (url.startsWith('happy://terminal?') || url.startsWith('happy:///terminal?')) {
        return 'terminal';
    }
    if (url.startsWith('happy:///account?') || url.startsWith('happy://account?')) {
        return 'account';
    }
    return null;
}

function extractPublicKeyFromAuthUrl(url: string): string | null {
    const questionIndex = url.indexOf('?');
    if (questionIndex === -1) {
        return null;
    }

    const rawQuery = url.slice(questionIndex + 1).trim();
    if (!rawQuery) {
        return null;
    }

    const searchParams = new URLSearchParams(rawQuery);

    const namedKey = searchParams.get('key');
    if (namedKey && namedKey.length > 0) {
        return namedKey;
    }

    // Legacy format uses the base64url public key as a query key:
    // happy://terminal?<publicKey>[&autoconnect=1]
    for (const key of searchParams.keys()) {
        if (key !== 'autoconnect' && key.length > 0) {
            return key;
        }
    }

    if (!rawQuery.includes('=')) {
        const firstChunk = rawQuery.split('&')[0]?.trim();
        return firstChunk && firstChunk.length > 0 ? firstChunk : null;
    }

    return null;
}

export function useConnectTerminal(options?: UseConnectTerminalOptions) {
    const auth = useAuth();
    const [isLoading, setIsLoading] = React.useState(false);
    const checkScannerPermissions = useCheckScannerPermissions();

    const processAuthUrl = React.useCallback(async (url: string) => {
        const kind = getAuthUrlKind(url);
        if (!kind) {
            Modal.alert(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
            return false;
        }

        setIsLoading(true);
        try {
            const encodedPublicKey = extractPublicKeyFromAuthUrl(url);
            if (!encodedPublicKey) {
                Modal.alert(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
                return false;
            }

            const publicKey = decodeBase64(encodedPublicKey, 'base64url');
            const secret = decodeBase64(auth.credentials!.secret, 'base64url');

            if (kind === 'terminal') {
                const responseV1 = encryptBox(secret, publicKey);
                const responseV2Bundle = new Uint8Array(sync.encryption.contentDataKey.length + 1);
                responseV2Bundle[0] = 0;
                responseV2Bundle.set(sync.encryption.contentDataKey, 1);
                const responseV2 = encryptBox(responseV2Bundle, publicKey);
                await authApprove(auth.credentials!.token, publicKey, responseV1, responseV2);

                Modal.alert(t('common.success'), t('modals.terminalConnectedSuccessfully'), [
                    {
                        text: t('common.ok'),
                        onPress: () => options?.onSuccess?.()
                    }
                ]);
            } else {
                const response = encryptBox(secret, publicKey);
                await authAccountApprove(auth.credentials!.token, publicKey, response);

                Modal.alert(t('common.success'), t('modals.deviceLinkedSuccessfully'), [
                    {
                        text: t('common.ok'),
                        onPress: () => options?.onSuccess?.()
                    }
                ]);
            }

            return true;
        } catch (e) {
            console.error(e);
            Modal.alert(
                t('common.error'),
                kind === 'account' ? t('modals.failedToLinkDevice') : t('modals.failedToConnectTerminal'),
                [{ text: t('common.ok') }]
            );
            options?.onError?.(e);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, [auth.credentials, options]);

    const connectTerminal = React.useCallback(async () => {
        if (await checkScannerPermissions()) {
            // Use camera scanner
            CameraView.launchScanner({
                barcodeTypes: ['qr']
            });
        } else {
            Modal.alert(t('common.error'), t('modals.cameraPermissionsRequiredToConnectTerminal'), [{ text: t('common.ok') }]);
        }
    }, [checkScannerPermissions]);

    const connectWithUrl = React.useCallback(async (url: string) => {
        return await processAuthUrl(url);
    }, [processAuthUrl]);

    // Set up barcode scanner listener
    React.useEffect(() => {
        if (CameraView.isModernBarcodeScannerAvailable) {
            const subscription = CameraView.onModernBarcodeScanned(async (event) => {
                const kind = getAuthUrlKind(event.data);
                if (kind) {
                    // Dismiss scanner on Android is called automatically when barcode is scanned
                    if (Platform.OS === 'ios') {
                        await CameraView.dismissScanner();
                    }
                    await processAuthUrl(event.data);
                }
            });
            return () => {
                subscription.remove();
            };
        }
    }, [processAuthUrl]);

    return {
        connectTerminal,
        connectWithUrl,
        isLoading,
        processAuthUrl
    };
}
