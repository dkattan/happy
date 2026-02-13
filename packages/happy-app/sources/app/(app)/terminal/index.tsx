import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/StyledText';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Ionicons } from '@expo/vector-icons';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

export default function TerminalScreen() {
    const router = useRouter();
    const searchParams = useLocalSearchParams();
    const { theme } = useUnistyles();
    const hasAutoConnectedRef = React.useRef(false);

    // const [urlProcessed, setUrlProcessed] = useState(false);
    const publicKey = React.useMemo(() => {
        const directKey = typeof searchParams.key === 'string' ? searchParams.key : null;
        if (directKey) {
            return directKey;
        }

        const keys = Object.keys(searchParams);
        if (keys.length > 0) {
            // Keep backward compatibility with legacy "happy://terminal?<publicKey>" URLs
            const key = keys.find(k => k !== 'autoconnect') || keys[0];
            return key;
        } else {
            return null;
        }
    }, [searchParams])
    const shouldAutoConnect = __DEV__ && (searchParams.autoconnect === '1' || searchParams.autoconnect === '');
    const { processAuthUrl, isLoading } = useConnectTerminal({
        onSuccess: () => {
            router.back();
        }
    });

    const handleConnect = React.useCallback(async () => {
        if (publicKey) {
            // Use the full happy:// URL format expected by the hook
            const authUrl = `happy://terminal?${publicKey}`;
            await processAuthUrl(authUrl);
        }
    }, [publicKey, processAuthUrl]);

    React.useEffect(() => {
        if (!shouldAutoConnect || !publicKey || hasAutoConnectedRef.current) {
            return;
        }
        hasAutoConnectedRef.current = true;
        void handleConnect();
    }, [shouldAutoConnect, publicKey, handleConnect]);

    const handleReject = () => {
        router.back();
    };

    // Show error if no key found
    if (!publicKey) {
        return (
            <>
                <ItemList>
                    <ItemGroup>
                        <View style={{
                            alignItems: 'center',
                            paddingVertical: 32,
                            paddingHorizontal: 16
                        }}>
                            <Ionicons
                                name="warning-outline"
                                size={48}
                                color={theme.colors.textDestructive}
                                style={{ marginBottom: 16 }}
                            />
                            <Text style={{
                                ...Typography.default('semiBold'),
                                fontSize: 16,
                                color: theme.colors.textDestructive,
                                textAlign: 'center',
                                marginBottom: 8
                            }}>
                                {t('terminal.invalidConnectionLink')}
                            </Text>
                            <Text style={{
                                ...Typography.default(),
                                fontSize: 14,
                                color: theme.colors.textSecondary,
                                textAlign: 'center',
                                lineHeight: 20
                            }}>
                                {t('terminal.invalidConnectionLinkDescription')}
                            </Text>
                        </View>
                    </ItemGroup>
                </ItemList>
            </>
        );
    }

    // Show confirmation screen for valid connection
    return (
        <>
            <ItemList>
                {/* Connection Request Header */}
                <ItemGroup>
                    <View style={{
                        alignItems: 'center',
                        paddingVertical: 24,
                        paddingHorizontal: 16
                    }}>
                        <Ionicons
                            name="terminal-outline"
                            size={48}
                            color={theme.colors.radio.active}
                            style={{ marginBottom: 16 }}
                        />
                        <Text style={{
                            ...Typography.default('semiBold'),
                            fontSize: 20,
                            textAlign: 'center',
                            marginBottom: 12,
                            color: theme.colors.text
                        }}>
                            {t('terminal.connectTerminal')}
                        </Text>
                        <Text style={{
                            ...Typography.default(),
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            lineHeight: 20
                        }}>
                            {t('terminal.terminalRequestDescription')}
                        </Text>
                    </View>
                </ItemGroup>

                {/* Connection Details */}
                <ItemGroup title={t('terminal.connectionDetails')}>
                    <Item
                        title={t('terminal.publicKey')}
                        detail={`${publicKey.substring(0, 12)}...`}
                        icon={<Ionicons name="key-outline" size={29} color={theme.colors.radio.active} />}
                        showChevron={false}
                    />
                    <Item
                        title={t('terminal.encryption')}
                        detail={t('terminal.endToEndEncrypted')}
                        icon={<Ionicons name="lock-closed-outline" size={29} color={theme.colors.success} />}
                        showChevron={false}
                    />
                </ItemGroup>

                {/* Action Buttons */}
                <ItemGroup>
                    <View style={{
                        paddingHorizontal: 16,
                        paddingVertical: 16,
                        gap: 12
                    }}>
                        <RoundButton
                            title={isLoading ? t('terminal.connecting') : t('terminal.acceptConnection')}
                            onPress={handleConnect}
                            size="large"
                            disabled={isLoading}
                            loading={isLoading}
                        />
                        <RoundButton
                            title={t('terminal.reject')}
                            onPress={handleReject}
                            size="large"
                            display="inverted"
                            disabled={isLoading}
                        />
                    </View>
                </ItemGroup>

                {/* Security Notice */}
                <ItemGroup
                    title={t('terminal.security')}
                    footer={t('terminal.securityFooterDevice')}
                >
                    <Item
                        title={t('terminal.clientSideProcessing')}
                        subtitle={t('terminal.linkProcessedOnDevice')}
                        icon={<Ionicons name="shield-checkmark-outline" size={29} color={theme.colors.success} />}
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
}
