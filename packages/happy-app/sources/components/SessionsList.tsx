import React from 'react';
import { View, Pressable, FlatList, Platform, TextInput, ActivityIndicator } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { usePathname } from 'expo-router';
import { SessionListViewItem, CopilotConversationListItem } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionSubtitle, getSessionAvatarId, formatLastSeen } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { ActiveSessionsGroup } from './ActiveSessionsGroup';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSetting } from '@/sync/storage';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { StatusDot } from './StatusDot';
import { StyleSheet } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { requestReview } from '@/utils/requestReview';
import { UpdateBanner } from './UpdateBanner';
import { layout } from './layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { useHappyAction } from '@/hooks/useHappyAction';
import { machineOpenVscodeSession, sessionDelete, type VscodeAppTarget } from '@/sync/ops';
import { HappyError } from '@/utils/errors';
import { Modal } from '@/modal';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    headerSection: {
        backgroundColor: theme.colors.groupped.background,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 8,
    },
    headerText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    projectGroup: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
    },
    projectGroupTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    projectGroupSubtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    sessionItem: {
        height: 88,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemContainer: {
        marginHorizontal: 16,
        marginBottom: 1,
        overflow: 'hidden',
    },
    sessionItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
    },
    sessionItemContainerFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemContainerLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionItemContainerSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionItemSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
        ...Typography.default('semiBold'),
    },
    sessionTitleConnected: {
        color: theme.colors.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        ...Typography.default(),
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginTop: 2,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    avatarContainer: {
        position: 'relative',
        width: 48,
        height: 48,
    },
    draftIconContainer: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftIconOverlay: {
        color: theme.colors.textSecondary,
    },
    artifactsSection: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: theme.colors.groupped.background,
    },
    swipeAction: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 12,
        color: '#FFFFFF',
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    copilotCard: {
        marginHorizontal: 16,
        marginBottom: 12,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
    },
    copilotRow: {
        minHeight: 84,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
    },
    copilotRowBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    copilotIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        marginRight: 12,
    },
    copilotContent: {
        flex: 1,
    },
    copilotTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    copilotTitle: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    copilotSubtitle: {
        marginTop: 2,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    copilotStatusRow: {
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
    },
    copilotStatusText: {
        fontSize: 12,
        ...Typography.default(),
    },
    copilotInstanceHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 10,
        backgroundColor: theme.colors.surfaceHighest,
    },
    copilotInstanceMain: {
        flex: 1,
    },
    copilotInstanceHeaderPressable: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 2,
    },
    copilotInstanceHeaderFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    copilotInstanceTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    copilotInstanceTitle: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    copilotInstanceChevron: {
        marginLeft: 8,
    },
    copilotInstanceSubtitle: {
        marginTop: 2,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    copilotInstanceActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    copilotInstanceActionButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    copilotSearchContainer: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        backgroundColor: theme.colors.surfaceHighest,
    },
    copilotSearchInput: {
        height: 34,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        color: theme.colors.text,
        paddingHorizontal: 10,
        fontSize: 13,
        ...Typography.default(),
    },
    copilotEmptySearchRow: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    copilotEmptySearchText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    copilotInstanceSeparator: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
}));

function getPathTail(pathLike: string | null | undefined): string {
    if (!pathLike || typeof pathLike !== 'string') {
        return '';
    }
    const parts = pathLike.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? pathLike;
}

function getEditorFamily(appName: string | null | undefined): { key: 'vscode' | 'insiders' | 'other'; label: string } {
    if (!appName || typeof appName !== 'string') {
        return { key: 'vscode', label: 'VS Code' };
    }
    const normalized = appName.toLowerCase();
    if (normalized.includes('insider')) {
        return { key: 'insiders', label: 'VS Code Insiders' };
    }
    if (normalized.includes('visual studio code') || normalized.includes('vscode')) {
        return { key: 'vscode', label: 'VS Code' };
    }
    return { key: 'other', label: appName };
}

function getInstanceLabel(conversation: CopilotConversationListItem): string {
    const instance = conversation.instance;
    if (!instance) {
        return `Window ${conversation.session.instanceId.slice(0, 8)}`;
    }

    const workspaceFileName = getPathTail(instance.workspaceFile);
    if (workspaceFileName) {
        return workspaceFileName;
    }

    if (Array.isArray(instance.workspaceFolders) && instance.workspaceFolders.length > 0) {
        const first = getPathTail(instance.workspaceFolders[0]);
        if (instance.workspaceFolders.length === 1) {
            return first || t('machine.vscodeWorkspace');
        }
        return `${first || t('machine.vscodeWorkspace')} +${instance.workspaceFolders.length - 1}`;
    }

    return `${instance.appName} (${instance.platform})`;
}

function getWorkspaceLabel(conversation: CopilotConversationListItem): string {
    const displayName = conversation.session.displayName;
    if (displayName && displayName.trim().length > 0) {
        return displayName.trim();
    }

    const workspaceDir = conversation.session.workspaceDir;
    const workspaceTail = getPathTail(workspaceDir);
    if (workspaceTail) {
        return workspaceTail;
    }

    const workspaceFileTail = getPathTail(conversation.instance?.workspaceFile);
    if (workspaceFileTail) {
        return workspaceFileTail;
    }

    return conversation.session.source === 'empty-window'
        ? t('machine.vscodeEmptyWindow')
        : t('machine.vscodeWorkspace');
}

function formatWorkspaceId(workspaceId: string | null | undefined): string {
    if (!workspaceId || workspaceId.trim().length === 0) {
        return '';
    }
    const trimmed = workspaceId.trim();
    return trimmed.length > 8 ? `${trimmed.slice(0, 8)}...` : trimmed;
}

export function SessionsList() {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const data = useVisibleSessionListViewData();
    const pathname = usePathname();
    const isTablet = useIsTablet();
    const compactSessionView = useSetting('compactSessionView');
    const router = useRouter();
    const selectable = isTablet;
    const dataWithSelected = selectable ? React.useMemo(() => {
        return data?.map(item => ({
            ...item,
            selected: pathname.startsWith(`/session/${item.type === 'session' ? item.session.id : ''}`)
        }));
    }, [data, pathname]) : data;

    const handleCreateConversationForInstance = React.useCallback(async (conversation: CopilotConversationListItem) => {
        const appTarget: VscodeAppTarget = conversation.instance?.appName?.toLowerCase().includes('insider')
            ? 'insiders'
            : 'vscode';
        try {
            const result = await machineOpenVscodeSession(conversation.machine.id, {
                instanceId: conversation.session.instanceId,
                workspaceDir: conversation.session.workspaceDir,
                workspaceFile: conversation.instance?.workspaceFile ?? undefined,
                newWindow: false,
                appTarget,
            });
            if (!result.ok) {
                throw new Error('Failed to create a new Copilot conversation.');
            }
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : 'Failed to create a new Copilot conversation.'
            );
        }
    }, []);

    // Request review
    React.useEffect(() => {
        if (data && data.length > 0) {
            requestReview();
        }
    }, [data && data.length > 0]);

    // Early return if no data yet
    if (!data) {
        return (
            <View style={styles.container} />
        );
    }

    const keyExtractor = React.useCallback((item: SessionListViewItem & { selected?: boolean }, index: number) => {
        switch (item.type) {
            case 'header': return `header-${item.title}-${index}`;
            case 'active-sessions': return 'active-sessions';
            case 'copilot-sessions': return 'copilot-sessions';
            case 'project-group': return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
            case 'session': return `session-${item.session.id}`;
        }
    }, []);

    const renderItem = React.useCallback(({ item, index }: { item: SessionListViewItem & { selected?: boolean }, index: number }) => {
        switch (item.type) {
            case 'header':
                return (
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {item.title}
                        </Text>
                    </View>
                );

            case 'active-sessions':
                // Extract just the session ID from pathname (e.g., /session/abc123/file -> abc123)
                let selectedId: string | undefined;
                if (isTablet && pathname.startsWith('/session/')) {
                    const parts = pathname.split('/');
                    selectedId = parts[2]; // parts[0] is empty, parts[1] is 'session', parts[2] is the ID
                }

                const ActiveComponent = compactSessionView ? ActiveSessionsGroupCompact : ActiveSessionsGroup;
                return (
                    <ActiveComponent
                        sessions={item.sessions}
                        selectedSessionId={selectedId}
                    />
                );

            case 'project-group':
                return (
                    <View style={styles.projectGroup}>
                        <Text style={styles.projectGroupTitle}>
                            {item.displayPath}
                        </Text>
                        <Text style={styles.projectGroupSubtitle}>
                            {item.machine.metadata?.displayName || item.machine.metadata?.host || item.machine.id}
                        </Text>
                    </View>
                );

            case 'session':
                // Determine card styling based on position within date group
                const prevItem = index > 0 && dataWithSelected ? dataWithSelected[index - 1] : null;
                const nextItem = index < (dataWithSelected?.length || 0) - 1 && dataWithSelected ? dataWithSelected[index + 1] : null;

                const isFirst = prevItem?.type === 'header';
                const isLast = nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
                const isSingle = isFirst && isLast;

                return (
                    <SessionItem
                        session={item.session}
                        selected={item.selected}
                        isFirst={isFirst}
                        isLast={isLast}
                        isSingle={isSingle}
                    />
                );

            case 'copilot-sessions':
                return (
                    <CopilotSessionsGroup
                        conversations={item.conversations}
                        onPressConversation={(conversation) => router.push(
                            `/copilot/${encodeURIComponent(conversation.machine.id)}/${encodeURIComponent(conversation.session.instanceId)}/${encodeURIComponent(conversation.session.id)}` as any
                        )}
                        onCreateConversation={handleCreateConversationForInstance}
                    />
                );
        }
    }, [pathname, dataWithSelected, compactSessionView, router, handleCreateConversationForInstance]);


    // Remove this section as we'll use FlatList for all items now


    const HeaderComponent = React.useCallback(() => {
        return (
            <UpdateBanner />
        );
    }, []);

    // Footer removed - all sessions now shown inline

    return (
        <View style={styles.container}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={dataWithSelected}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={{ paddingBottom: safeArea.bottom + 128, maxWidth: layout.maxWidth }}
                    ListHeaderComponent={HeaderComponent}
                />
            </View>
        </View>
    );
}

// Sub-component that handles session message logic
const SessionItem = React.memo(({ session, selected, isFirst, isLast, isSingle }: {
    session: Session;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const navigateToSession = useNavigateToSession();
    const isTablet = useIsTablet();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';

    const [deletingSession, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
    });

    const handleDelete = React.useCallback(() => {
        swipeableRef.current?.close();
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    const itemContent = (
        <Pressable
            style={[
                styles.sessionItem,
                selected && styles.sessionItemSelected,
                isSingle ? styles.sessionItemSingle :
                    isFirst ? styles.sessionItemFirst :
                        isLast ? styles.sessionItemLast : {}
            ]}
            onPressIn={() => {
                if (isTablet) {
                    navigateToSession(session.id);
                }
            }}
            onPress={() => {
                if (!isTablet) {
                    navigateToSession(session.id);
                }
            }}
        >
            <View style={styles.avatarContainer}>
                <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} />
                {session.draft && (
                    <View style={styles.draftIconContainer}>
                        <Ionicons
                            name="create-outline"
                            size={12}
                            style={styles.draftIconOverlay}
                        />
                    </View>
                )}
            </View>
            <View style={styles.sessionContent}>
                {/* Title line */}
                <View style={styles.sessionTitleRow}>
                    <Text style={[
                        styles.sessionTitle,
                        sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                    ]} numberOfLines={1}> {/* {variant !== 'no-path' ? 1 : 2} - issue is we don't have anything to take this space yet and it looks strange - if summaries were more reliably generated, we can add this. While no summary - add something like "New session" or "Empty session", and extend summary to 2 lines once we have it */}
                        {sessionName}
                    </Text>
                </View>

                {/* Subtitle line */}
                <Text style={styles.sessionSubtitle} numberOfLines={1}>
                    {sessionSubtitle}
                </Text>

                {/* Status line with dot */}
                <View style={styles.statusRow}>
                    <View style={styles.statusDotContainer}>
                        <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                    </View>
                    <Text style={[
                        styles.statusText,
                        { color: sessionStatus.statusColor }
                    ]}>
                        {sessionStatus.statusText}
                    </Text>
                </View>
            </View>
        </Pressable>
    );

    const containerStyles = [
        styles.sessionItemContainer,
        isSingle ? styles.sessionItemContainerSingle :
            isFirst ? styles.sessionItemContainerFirst :
                isLast ? styles.sessionItemContainerLast : {}
    ];

    if (!swipeEnabled) {
        return (
            <View style={containerStyles}>
                {itemContent}
            </View>
        );
    }

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeAction}
            onPress={handleDelete}
            disabled={deletingSession}
        >
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={2}>
                {t('sessionInfo.deleteSession')}
            </Text>
        </Pressable>
    );

    return (
        <View style={containerStyles}>
            <Swipeable
                ref={swipeableRef}
                renderRightActions={renderRightActions}
                overshootRight={false}
                enabled={!deletingSession}
            >
                {itemContent}
            </Swipeable>
        </View>
    );
});

const CopilotSessionsGroup = React.memo(({ conversations, onPressConversation, onCreateConversation }: {
    conversations: CopilotConversationListItem[];
    onPressConversation: (conversation: CopilotConversationListItem) => void;
    onCreateConversation: (conversation: CopilotConversationListItem) => Promise<void>;
}) => {
    const styles = stylesheet;
    const [collapsedByInstance, setCollapsedByInstance] = React.useState<Record<string, boolean>>({});
    const [searchByInstance, setSearchByInstance] = React.useState<Record<string, string>>({});
    const [creatingByInstance, setCreatingByInstance] = React.useState<Record<string, boolean>>({});

    const groupedConversationsByApp = React.useMemo(() => {
        const appGroups = new Map<string, {
            key: 'vscode' | 'insiders' | 'other';
            label: string;
            appLastResponse: number;
            instances: Map<string, {
                key: string;
                machineName: string;
                instanceLabel: string;
                workspaceLabel: string;
                workspaceId: string;
                instanceLastResponse: number;
                conversations: CopilotConversationListItem[];
            }>;
        }>();

        conversations.forEach((conversation) => {
            const appFamily = getEditorFamily(conversation.instance?.appName);
            const machineName = conversation.machine.metadata?.displayName
                || conversation.machine.metadata?.host
                || conversation.machine.id;
            const instanceLabel = getInstanceLabel(conversation);
            const workspaceLabel = getWorkspaceLabel(conversation);
            const workspaceId = formatWorkspaceId(conversation.session.workspaceId);
            const instanceLastResponse = conversation.session.lastMessageDate
                || conversation.instance?.lastSeen
                || 0;
            const instanceKey = `${conversation.machine.id}:${conversation.session.instanceId}`;
            const existingAppGroup = appGroups.get(appFamily.key);
            const appGroup = existingAppGroup ?? {
                key: appFamily.key,
                label: appFamily.label,
                appLastResponse: 0,
                instances: new Map<string, {
                    key: string;
                    machineName: string;
                    instanceLabel: string;
                    workspaceLabel: string;
                    workspaceId: string;
                    instanceLastResponse: number;
                    conversations: CopilotConversationListItem[];
                }>()
            };

            appGroup.appLastResponse = Math.max(appGroup.appLastResponse, instanceLastResponse);

            const existing = appGroup.instances.get(instanceKey);
            if (existing) {
                existing.conversations.push(conversation);
                existing.instanceLastResponse = Math.max(existing.instanceLastResponse, instanceLastResponse);
                if (!existing.workspaceId && workspaceId) {
                    existing.workspaceId = workspaceId;
                }
                appGroups.set(appFamily.key, appGroup);
                return;
            }

            appGroup.instances.set(instanceKey, {
                key: instanceKey,
                machineName,
                instanceLabel,
                workspaceLabel,
                workspaceId,
                instanceLastResponse,
                conversations: [conversation],
            });
            appGroups.set(appFamily.key, appGroup);
        });

        const appOrder: Record<string, number> = {
            vscode: 0,
            insiders: 1,
            other: 2,
        };

        const normalized = Array.from(appGroups.values()).map((appGroup) => {
            const instances = Array.from(appGroup.instances.values());
            instances.sort((a, b) => b.instanceLastResponse - a.instanceLastResponse);
            instances.forEach((group) => {
                const seenConversations = new Set<string>();
                group.conversations = group.conversations.filter((conversation) => {
                    const dedupeKey = `${conversation.machine.id}:${conversation.session.instanceId}:${conversation.session.id}:${conversation.session.jsonPath}`;
                    if (seenConversations.has(dedupeKey)) {
                        return false;
                    }
                    seenConversations.add(dedupeKey);
                    return true;
                });
                group.conversations.sort((a, b) => {
                    if (a.session.needsInput !== b.session.needsInput) {
                        return Number(b.session.needsInput) - Number(a.session.needsInput);
                    }
                    return (b.session.lastMessageDate ?? 0) - (a.session.lastMessageDate ?? 0);
                });
            });
            return {
                key: appGroup.key,
                label: appGroup.label,
                appLastResponse: appGroup.appLastResponse,
                instances,
            };
        });

        normalized.sort((a, b) => {
            const orderDelta = (appOrder[a.key] ?? 999) - (appOrder[b.key] ?? 999);
            if (orderDelta !== 0) {
                return orderDelta;
            }
            return b.appLastResponse - a.appLastResponse;
        });

        return normalized;
    }, [conversations]);

    React.useEffect(() => {
        const instanceKeys = new Set<string>();
        groupedConversationsByApp.forEach((appGroup) => {
            appGroup.instances.forEach((group) => {
                instanceKeys.add(group.key);
            });
        });

        setCollapsedByInstance((previous) => {
            const next: Record<string, boolean> = {};
            instanceKeys.forEach((key) => {
                next[key] = previous[key] ?? true;
            });
            return next;
        });

        setSearchByInstance((previous) => {
            const next: Record<string, string> = {};
            instanceKeys.forEach((key) => {
                next[key] = previous[key] ?? '';
            });
            return next;
        });
    }, [groupedConversationsByApp]);

    const toggleCollapsed = React.useCallback((instanceKey: string) => {
        setCollapsedByInstance((previous) => ({
            ...previous,
            [instanceKey]: !(previous[instanceKey] ?? true),
        }));
    }, []);

    const handleSearchChange = React.useCallback((instanceKey: string, value: string) => {
        setSearchByInstance((previous) => ({
            ...previous,
            [instanceKey]: value,
        }));
    }, []);

    const handleCreateConversation = React.useCallback(async (instanceKey: string, seedConversation: CopilotConversationListItem) => {
        setCreatingByInstance((previous) => ({ ...previous, [instanceKey]: true }));
        try {
            await onCreateConversation(seedConversation);
            setCollapsedByInstance((previous) => ({ ...previous, [instanceKey]: false }));
        } finally {
            setCreatingByInstance((previous) => ({ ...previous, [instanceKey]: false }));
        }
    }, [onCreateConversation]);

    return (
        <View>
            {groupedConversationsByApp.map((appGroup) => (
                <View key={appGroup.key}>
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {appGroup.label}
                        </Text>
                    </View>
                    <View style={styles.copilotCard}>
                        {appGroup.instances.map((group, groupIndex) => {
                            const isCollapsed = collapsedByInstance[group.key] ?? true;
                            const search = (searchByInstance[group.key] ?? '').trim().toLowerCase();
                            const visibleConversations = search.length === 0
                                ? group.conversations
                                : group.conversations.filter((conversation) => {
                                    const searchable = `${conversation.session.title} ${conversation.session.id}`.toLowerCase();
                                    return searchable.includes(search);
                                });
                            const isCreating = creatingByInstance[group.key] === true;
                            const seedConversation = group.conversations[0];
                            const conversationCountLabel = `${group.conversations.length} conversation${group.conversations.length === 1 ? '' : 's'}`;
                            const lastResponseLabel = group.instanceLastResponse > 0
                                ? formatLastSeen(group.instanceLastResponse, false)
                                : 'none';
                            const workspaceLabel = group.workspaceId
                                ? `${group.workspaceLabel} (${group.workspaceId})`
                                : group.workspaceLabel;

                            return (
                                <View key={`${appGroup.key}:${group.key}`}>
                                    <View
                                        style={[
                                            styles.copilotInstanceHeader,
                                            groupIndex === 0 && styles.copilotInstanceHeaderFirst
                                        ]}
                                    >
                                        <Pressable
                                            style={styles.copilotInstanceHeaderPressable}
                                            onPress={() => toggleCollapsed(group.key)}
                                        >
                                            <View style={styles.copilotInstanceMain}>
                                                <View style={styles.copilotInstanceTitleRow}>
                                                    <Text style={styles.copilotInstanceTitle} numberOfLines={1}>
                                                        {group.machineName} • {group.instanceLabel}
                                                    </Text>
                                                    <Ionicons
                                                        name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                                                        size={14}
                                                        color="#7C7C7C"
                                                        style={styles.copilotInstanceChevron}
                                                    />
                                                </View>
                                                <Text style={styles.copilotInstanceSubtitle} numberOfLines={2}>
                                                    {`Workspace ${workspaceLabel} • ${conversationCountLabel} • Last response ${lastResponseLabel}`}
                                                </Text>
                                            </View>
                                        </Pressable>
                                        <View style={styles.copilotInstanceActions}>
                                            <Pressable
                                                style={styles.copilotInstanceActionButton}
                                                onPress={() => {
                                                    if (!seedConversation || isCreating) return;
                                                    void handleCreateConversation(group.key, seedConversation);
                                                }}
                                                disabled={!seedConversation || isCreating}
                                                hitSlop={10}
                                            >
                                                {isCreating ? (
                                                    <ActivityIndicator size="small" color="#7C7C7C" />
                                                ) : (
                                                    <Ionicons name="add" size={16} color="#7C7C7C" />
                                                )}
                                            </Pressable>
                                        </View>
                                    </View>

                                    {!isCollapsed && (
                                        <>
                                            <View style={styles.copilotSearchContainer}>
                                                <TextInput
                                                    value={searchByInstance[group.key] ?? ''}
                                                    onChangeText={(value) => handleSearchChange(group.key, value)}
                                                    placeholder="Search conversations in this workspace"
                                                    placeholderTextColor="#9C9C9C"
                                                    style={styles.copilotSearchInput}
                                                />
                                            </View>
                                            {visibleConversations.length === 0 && (
                                                <View style={styles.copilotEmptySearchRow}>
                                                    <Text style={styles.copilotEmptySearchText}>
                                                        No matching conversations
                                                    </Text>
                                                </View>
                                            )}
                                            {visibleConversations.map((conversation, index) => {
                                                const lastResponseAt = conversation.session.lastMessageDate ?? 0;
                                                const statusText = conversation.session.needsInput
                                                    ? t('machine.vscodeNeedsInput')
                                                    : (lastResponseAt > 0
                                                        ? `Last response ${formatLastSeen(lastResponseAt, false)}`
                                                        : 'No responses yet');
                                                const statusColor = conversation.session.needsInput ? '#FF3B30' : '#888888';
                                                const isLastInGroup = index === visibleConversations.length - 1;
                                                const isLastGroup = groupIndex === appGroup.instances.length - 1;

                                                return (
                                                    <Pressable
                                                        key={`${conversation.machine.id}:${conversation.session.instanceId}:${conversation.session.id}:${conversation.session.jsonPath}`}
                                                        style={[
                                                            styles.copilotRow,
                                                            (!isLastInGroup || !isLastGroup) && styles.copilotRowBorder
                                                        ]}
                                                        onPress={() => onPressConversation(conversation)}
                                                    >
                                                        <View style={styles.copilotIconContainer}>
                                                            <Ionicons
                                                                name={conversation.session.needsInput ? 'alert-circle' : 'logo-github'}
                                                                size={18}
                                                                color={conversation.session.needsInput ? '#FF3B30' : '#4A5568'}
                                                            />
                                                        </View>
                                                        <View style={styles.copilotContent}>
                                                            <View style={styles.copilotTitleRow}>
                                                                <Text style={styles.copilotTitle} numberOfLines={1}>
                                                                    {conversation.session.title}
                                                                </Text>
                                                            </View>
                                                            <View style={styles.copilotStatusRow}>
                                                                {conversation.session.needsInput && (
                                                                    <StatusDot color={statusColor} isPulsing />
                                                                )}
                                                                <Text
                                                                    style={[
                                                                        styles.copilotStatusText,
                                                                        {
                                                                            color: statusColor,
                                                                            marginLeft: conversation.session.needsInput ? 4 : 0
                                                                        }
                                                                    ]}
                                                                    numberOfLines={1}
                                                                >
                                                                    {statusText}
                                                                </Text>
                                                            </View>
                                                        </View>
                                                    </Pressable>
                                                );
                                            })}
                                        </>
                                    )}
                                    {groupIndex < appGroup.instances.length - 1 && (
                                        <View style={styles.copilotInstanceSeparator} />
                                    )}
                                </View>
                            );
                        })}
                    </View>
                </View>
            ))}
        </View>
    );
});
