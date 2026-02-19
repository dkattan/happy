import * as React from 'react';
import { View, ActivityIndicator, Text, Pressable } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useFriendRequests, useKnownMachines, useProfile, useSocketStatus, useRealtimeStatus } from '@/sync/storage';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useIsTablet } from '@/utils/responsive';
import { useRouter } from 'expo-router';
import { EmptySessionsTablet } from './EmptySessionsTablet';
import { SessionsList } from './SessionsList';
import { FABWide } from './FABWide';
import { TabBar, TabType } from './TabBar';
import { InboxView } from './InboxView';
import { SettingsViewWrapper } from './SettingsViewWrapper';
import { SessionsListWrapper } from './SessionsListWrapper';
import { Header } from './navigation/Header';
import { HeaderLogo } from './HeaderLogo';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { StatusDot } from './StatusDot';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { getServerInfo, getServerUrl, isUsingCustomServer } from '@/sync/serverConfig';
import { trackFriendsSearch } from '@/track';
import { isMachineOnline } from '@/utils/machineUtils';
import { Modal } from '@/modal';
import { apiSocket } from '@/sync/apiSocket';
import type { Machine } from '@/sync/storageTypes';
import { getDisplayName } from '@/sync/profile';

interface MainViewProps {
    variant: 'phone' | 'sidebar';
}

function getMachineDisplayName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

function formatDaemonConnectionSummary(machine: Machine, index: number): string {
    const daemonState = machine.daemonState as {
        pid?: number;
        httpPort?: number;
        startedWithCliVersion?: string;
    } | null;

    const status = isMachineOnline(machine) ? 'online' : 'offline';
    const pid = daemonState?.pid ?? machine.metadata?.daemonLastKnownPid;
    const port = daemonState?.httpPort;
    const cliVersion = daemonState?.startedWithCliVersion ?? machine.metadata?.happyCliVersion;
    const activeAt = machine.activeAt ? new Date(machine.activeAt).toLocaleString() : 'unknown';

    const lines = [
        `${index + 1}. ${getMachineDisplayName(machine)}`,
        `machineId: ${machine.id}`,
        `status: ${status}`,
        `pid: ${pid ?? 'unknown'}`,
        `port: ${port ?? 'unknown'}`,
        `cli: ${cliVersion ?? 'unknown'}`,
        `lastSeen: ${activeAt}`,
    ];

    return lines.join('\n');
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    phoneContainer: {
        flex: 1,
    },
    sidebarContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    tabletLoadingContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    titleContainer: {
        flex: 1,
        alignItems: 'center',
    },
    titleText: {
        fontSize: 17,
        color: theme.colors.header.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -2,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    headerButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

// Tab header configuration (zen excluded as that tab is disabled)
const TAB_TITLES = {
    sessions: 'tabs.sessions',
    inbox: 'tabs.inbox',
    settings: 'tabs.settings',
} as const;

// Active tabs (excludes zen which is disabled)
type ActiveTabType = 'sessions' | 'inbox' | 'settings';

// Header title component with connection status
const HeaderTitle = React.memo(({ activeTab, onStatusPress }: { activeTab: ActiveTabType; onStatusPress?: () => void }) => {
    const { theme } = useUnistyles();
    const socketStatus = useSocketStatus();

    const connectionStatus = React.useMemo(() => {
        const { status } = socketStatus;
        switch (status) {
            case 'connected':
                return {
                    color: theme.colors.status.connected,
                    isPulsing: false,
                    text: t('status.connected'),
                };
            case 'connecting':
                return {
                    color: theme.colors.status.connecting,
                    isPulsing: true,
                    text: t('status.connecting'),
                };
            case 'disconnected':
                return {
                    color: theme.colors.status.disconnected,
                    isPulsing: false,
                    text: t('status.disconnected'),
                };
            case 'error':
                return {
                    color: theme.colors.status.error,
                    isPulsing: false,
                    text: t('status.error'),
                };
            default:
                return {
                    color: theme.colors.status.default,
                    isPulsing: false,
                    text: '',
                };
        }
    }, [socketStatus, theme]);

    return (
        <View style={styles.titleContainer}>
            <Text style={styles.titleText}>
                {t(TAB_TITLES[activeTab])}
            </Text>
            {connectionStatus.text && (
                activeTab === 'sessions' && onStatusPress ? (
                    <Pressable onPress={onStatusPress} hitSlop={8}>
                        <View style={styles.statusContainer}>
                            <StatusDot
                                color={connectionStatus.color}
                                isPulsing={connectionStatus.isPulsing}
                                size={6}
                                style={{ marginRight: 4 }}
                            />
                            <Text style={[styles.statusText, { color: connectionStatus.color }]}>
                                {connectionStatus.text}
                            </Text>
                        </View>
                    </Pressable>
                ) : (
                    <View style={styles.statusContainer}>
                        <StatusDot
                            color={connectionStatus.color}
                            isPulsing={connectionStatus.isPulsing}
                            size={6}
                            style={{ marginRight: 4 }}
                        />
                        <Text style={[styles.statusText, { color: connectionStatus.color }]}>
                            {connectionStatus.text}
                        </Text>
                    </View>
                )
            )}
        </View>
    );
});

// Header right button - varies by tab
const HeaderRight = React.memo(({ activeTab }: { activeTab: ActiveTabType }) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const isCustomServer = isUsingCustomServer();

    if (activeTab === 'sessions') {
        return (
            <Pressable
                onPress={() => router.push('/new')}
                hitSlop={15}
                style={styles.headerButton}
            >
                <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    if (activeTab === 'inbox') {
        return (
            <Pressable
                onPress={() => {
                    trackFriendsSearch();
                    router.push('/friends/search');
                }}
                hitSlop={15}
                style={styles.headerButton}
            >
                <Ionicons name="person-add-outline" size={24} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    if (activeTab === 'settings') {
        if (!isCustomServer) {
            // Empty view to maintain header centering
            return <View style={styles.headerButton} />;
        }
        return (
            <Pressable
                onPress={() => router.push('/server')}
                hitSlop={15}
                style={styles.headerButton}
            >
                <Ionicons name="server-outline" size={24} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    return null;
});

export const MainView = React.memo(({ variant }: MainViewProps) => {
    const { theme } = useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();
    const isTablet = useIsTablet();
    const router = useRouter();
    const socketStatus = useSocketStatus();
    const friendRequests = useFriendRequests();
    const realtimeStatus = useRealtimeStatus();
    const profile = useProfile();
    const machines = useKnownMachines();

    // Tab state management
    // NOTE: Zen tab removed - the feature never got to a useful state
    const [activeTab, setActiveTab] = React.useState<TabType>('sessions');

    const handleNewSession = React.useCallback(() => {
        router.push('/new');
    }, [router]);

    const handleTabPress = React.useCallback((tab: TabType) => {
        setActiveTab(tab);
    }, []);

    const onlineDaemons = React.useMemo(() => {
        return [...machines]
            .filter((machine) => isMachineOnline(machine))
            .sort((a, b) => (b.activeAt || 0) - (a.activeAt || 0));
    }, [machines]);

    const primaryDaemon = onlineDaemons[0] ?? machines[0] ?? null;
    const primaryDaemonIsOnline = primaryDaemon ? isMachineOnline(primaryDaemon) : false;
    const handleChooseDaemon = React.useCallback(() => {
        const connectedDaemon = onlineDaemons[0];
        if (onlineDaemons.length === 1 && connectedDaemon) {
            router.push((`/machine/${encodeURIComponent(connectedDaemon.id)}` as any));
            return;
        }

        const selectedId = primaryDaemon ? encodeURIComponent(primaryDaemon.id) : '';
        router.push((selectedId
            ? `/new/pick/machine?selectedId=${selectedId}`
            : '/new/pick/machine') as any);
    }, [onlineDaemons, primaryDaemon, router]);

    const handleConnectionStatusPress = React.useCallback(() => {
        const serverInfo = getServerInfo();
        const serverUrl = getServerUrl();
        const socketDebug = apiSocket.getDebugInfo();
        const daemonPreview = machines.slice(0, 3).map(formatDaemonConnectionSummary).join('\n\n');
        const hasMoreDaemons = machines.length > 3;
        const primaryLabel = primaryDaemon
            ? `${getMachineDisplayName(primaryDaemon)} (${primaryDaemon.id}) [${primaryDaemonIsOnline ? 'online' : 'offline'}]`
            : 'none';
        const profileDisplayName = getDisplayName(profile) || profile.github?.login || 'unknown';
        const endpointLabel = socketDebug.endpoint || `${serverInfo.hostname}${serverInfo.port ? `:${serverInfo.port}` : ''}`;
        const appName = Constants.expoConfig?.name || 'Happy';
        const bundleId = Application.applicationId || 'unknown';
        const lastConnected = socketStatus.lastConnectedAt ? new Date(socketStatus.lastConnectedAt).toLocaleString() : 'never';
        const lastDisconnected = socketStatus.lastDisconnectedAt ? new Date(socketStatus.lastDisconnectedAt).toLocaleString() : 'never';

        const details = [
            `App: ${appName} (${bundleId})`,
            `Account: ${profileDisplayName} (${profile.id || 'unknown'})`,
            `Server URL: ${serverUrl}`,
            `Custom server override: ${serverInfo.isCustom ? 'yes' : 'no'}`,
            `Socket endpoint: ${endpointLabel}`,
            `Socket status: ${socketDebug.status}`,
            `Socket ID: ${socketDebug.socketId ?? 'not connected'}`,
            `Transport: ${socketDebug.transport ?? 'unknown'}`,
            `Last connected: ${lastConnected}`,
            `Last disconnected: ${lastDisconnected}`,
            '',
            `Known daemons: ${machines.length}`,
            `Online daemons: ${onlineDaemons.length}`,
            `Primary daemon: ${primaryLabel}`,
            daemonPreview || 'No daemons discovered for this account yet.',
            hasMoreDaemons ? `...and ${machines.length - 3} more` : '',
            '',
            'Tip: if simulator and phone disagree here, they are usually on different server/account contexts.',
        ].filter(Boolean).join('\n');

        const buttons: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [];
        if (primaryDaemon) {
            buttons.push({
                text: 'Open Primary Daemon',
                onPress: () => {
                    router.push((`/machine/${encodeURIComponent(primaryDaemon.id)}` as any));
                }
            });
        }
        if (machines.length > 1 && onlineDaemons.length !== 1) {
            buttons.push({
                text: 'Choose Daemon',
                onPress: handleChooseDaemon,
            });
        }
        buttons.push({
            text: t('common.copy'),
            onPress: () => {
                void Clipboard.setStringAsync(details).then(() => {
                    Modal.alert(t('common.success'), t('items.copiedToClipboard', { label: 'Connection details' }));
                }).catch(() => {
                    Modal.alert(t('common.error'), t('textSelection.failedToCopy'));
                });
            }
        });
        buttons.push({ text: t('common.ok'), style: 'cancel' });

        Modal.alert('Connection Details', details, buttons);
    }, [handleChooseDaemon, machines, onlineDaemons, primaryDaemon, primaryDaemonIsOnline, profile, socketStatus.lastConnectedAt, socketStatus.lastDisconnectedAt]);

    const hasPromptedEmptySessionsRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        const connected = socketStatus.status === 'connected';
        const hasData = sessionListViewData !== null;
        const hasVisibleSessions = !!sessionListViewData && sessionListViewData.length > 0;
        const onSessionsTab = activeTab === 'sessions';

        if (!connected || !onSessionsTab || !hasData || hasVisibleSessions) {
            hasPromptedEmptySessionsRef.current = null;
            return;
        }

        const promptKey = [
            socketStatus.lastConnectedAt ?? 0,
            socketStatus.status,
            machines.length,
            onlineDaemons.length,
        ].join(':');

        if (hasPromptedEmptySessionsRef.current === promptKey) {
            return;
        }
        hasPromptedEmptySessionsRef.current = promptKey;

        const buttons: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [];
        if (machines.length > 1 && onlineDaemons.length !== 1) {
            buttons.push({
                text: 'Choose Daemon',
                onPress: handleChooseDaemon,
            });
        }
        if (primaryDaemon) {
            buttons.push({
                text: 'Open Primary Daemon',
                onPress: () => {
                    router.push((`/machine/${encodeURIComponent(primaryDaemon.id)}` as any));
                }
            });
        }
        buttons.push({
            text: t('terminal.connectionDetails'),
            onPress: handleConnectionStatusPress,
        });
        buttons.push({ text: t('common.cancel'), style: 'cancel' });

        Modal.alert('Connected but no terminals', 'No terminal sessions are visible yet. Open daemon selection or inspect connection details.', buttons);
    }, [activeTab, handleChooseDaemon, handleConnectionStatusPress, machines.length, onlineDaemons.length, primaryDaemon, router, sessionListViewData, socketStatus.lastConnectedAt, socketStatus.status]);

    // Regular phone mode with tabs - define this before any conditional returns
    const renderTabContent = React.useCallback(() => {
        switch (activeTab) {
            case 'inbox':
                return <InboxView />;
            case 'settings':
                return <SettingsViewWrapper />;
            case 'sessions':
            default:
                return <SessionsListWrapper />;
        }
    }, [activeTab]);

    // Sidebar variant
    if (variant === 'sidebar') {
        // Loading state
        if (sessionListViewData === null) {
            return (
                <View style={styles.sidebarContentContainer}>
                    <View style={styles.tabletLoadingContainer}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                </View>
            );
        }

        // Empty state
        if (sessionListViewData.length === 0) {
            return (
                <View style={styles.sidebarContentContainer}>
                    <View style={styles.emptyStateContainer}>
                        <EmptySessionsTablet />
                    </View>
                </View>
            );
        }

        // Sessions list
        return (
            <View style={styles.sidebarContentContainer}>
                <SessionsList />
            </View>
        );
    }

    // Phone variant
    // Tablet in phone mode - special case (when showing index view on tablets, show empty view)
    if (isTablet) {
        // Just show an empty view on tablets for the index view
        // The sessions list is shown in the sidebar, so the main area should be blank
        return <View style={styles.emptyStateContentContainer} />;
    }

    // Regular phone mode with tabs
    return (
        <>
            <View style={styles.phoneContainer}>
                <View style={{ backgroundColor: theme.colors.groupped.background }}>
                    <Header
                        title={<HeaderTitle activeTab={activeTab as ActiveTabType} onStatusPress={handleConnectionStatusPress} />}
                        headerRight={() => <HeaderRight activeTab={activeTab as ActiveTabType} />}
                        headerLeft={() => <HeaderLogo />}
                        headerShadowVisible={false}
                        headerTransparent={true}
                    />
                    {realtimeStatus !== 'disconnected' && (
                        <VoiceAssistantStatusBar variant="full" />
                    )}
                </View>
                {renderTabContent()}
            </View>
            <TabBar
                activeTab={activeTab}
                onTabPress={handleTabPress}
                inboxBadgeCount={friendRequests.length}
            />
        </>
    );
});
