import React from 'react';
import { View, Pressable, FlatList, Platform, TextInput, ActivityIndicator, Text as NativeText } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { usePathname } from 'expo-router';
import {
    SessionListViewItem,
    CopilotConversationListItem,
    CopilotFlatConversationListItem,
    CopilotRecentWorkspaceListItem
} from '@/sync/storage';
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
import { machineOpenVscodeSession, machineSearch, sessionDelete, type VscodeAppTarget } from '@/sync/ops';
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
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
    },
    sessionItemContainerFirst: {
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
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
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
    copilotMachineHeader: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 6,
        backgroundColor: 'transparent',
    },
    copilotMachineTitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
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
    },
    copilotInstanceTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    copilotInstanceOpenDot: {
        marginRight: 6,
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
    copilotTopSearchContainer: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        backgroundColor: theme.colors.surfaceHighest,
    },
    copilotTopSearchInputRow: {
        height: 36,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
    },
    copilotTopSearchInput: {
        flex: 1,
        color: theme.colors.text,
        fontSize: 13,
        marginLeft: 8,
        ...Typography.default(),
    },
    copilotTopSearchError: {
        marginTop: 6,
        fontSize: 12,
        color: '#C84343',
        ...Typography.default(),
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
    copilotViewSwitchRow: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 8,
        backgroundColor: theme.colors.surfaceHighest,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    copilotRecentToggleButton: {
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    copilotRecentToggleButtonActive: {
        backgroundColor: theme.colors.surfaceSelected,
        borderColor: theme.colors.textSecondary,
    },
    copilotRecentToggleText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    copilotRecentToggleTextActive: {
        color: theme.colors.text,
    },
    copilotSessionModeSelector: {
        marginLeft: 12,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        padding: 2,
        flexDirection: 'row',
        alignItems: 'center',
    },
    copilotSessionModeButton: {
        width: 30,
        height: 24,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    copilotSessionModeButtonActive: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    copilotSessionModeButtonLoading: {
        opacity: 0.65,
    },
    copilotSessionModeIcon: {
        fontFamily: 'Codicon',
        fontSize: 14,
        lineHeight: 14,
        color: theme.colors.textSecondary,
    },
    copilotSessionModeIconActive: {
        color: theme.colors.text,
    },
    copilotOpenStateFilterRow: {
        paddingHorizontal: 16,
        paddingBottom: 8,
        backgroundColor: theme.colors.surfaceHighest,
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    copilotOpenStateSelector: {
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        padding: 2,
        flexDirection: 'row',
        alignItems: 'center',
    },
    copilotOpenStateButton: {
        height: 24,
        minWidth: 56,
        paddingHorizontal: 10,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    copilotOpenStateButtonActive: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    copilotOpenStateText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    copilotOpenStateTextActive: {
        color: theme.colors.text,
    },
    copilotMetaBadge: {
        marginLeft: 8,
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: theme.colors.surfaceHighest,
    },
    copilotMetaBadgeOpen: {
        backgroundColor: '#E7F8EC',
    },
    copilotMetaBadgeClosed: {
        backgroundColor: '#F2F2F2',
    },
    copilotMetaBadgeText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    copilotMetaBadgeTextOpen: {
        color: '#167C3C',
    },
    copilotRecentHeaderRow: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        backgroundColor: theme.colors.surfaceHighest,
    },
    copilotRecentHeaderText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
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

const CODICON_GLYPHS = {
    flat: '\ueb84',
    tree: '\ueb86',
} as const;

type OpenStateFilter = 'all' | 'open' | 'closed';
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type WorkspaceIdentity = {
    kind: 'folder' | 'workspace-file';
    path: string;
};

function normalizeWorkspacePath(pathLike: string): string {
    return pathLike.replace(/\\/g, '/').toLowerCase();
}

function buildWorkspacePathKey(machineId: string, appTarget: 'vscode' | 'insiders', identity: WorkspaceIdentity): string {
    return `${machineId}:${appTarget}:${identity.kind}:${normalizeWorkspacePath(identity.path)}`;
}

function getWorkspaceIdentityFromConversation(conversation: CopilotConversationListItem): WorkspaceIdentity | null {
    const workspaceFile = conversation.session.workspaceFile ?? conversation.instance?.workspaceFile ?? undefined;
    if (workspaceFile) {
        return { kind: 'workspace-file', path: workspaceFile };
    }

    const workspaceDir = conversation.session.workspaceDir
        ?? (conversation.instance?.workspaceFolders && conversation.instance.workspaceFolders.length > 0
            ? conversation.instance.workspaceFolders[0]
            : undefined);
    if (workspaceDir) {
        return { kind: 'folder', path: workspaceDir };
    }

    return null;
}

function getWorkspaceIdentityFromFlatConversation(conversation: CopilotFlatConversationListItem): WorkspaceIdentity | null {
    const workspaceFile = conversation.session.workspaceFile;
    if (workspaceFile) {
        return { kind: 'workspace-file', path: workspaceFile };
    }

    const workspaceDir = conversation.session.workspaceDir;
    if (workspaceDir) {
        return { kind: 'folder', path: workspaceDir };
    }

    return null;
}

function getWorkspaceIdentityFromRecentWorkspace(workspace: CopilotRecentWorkspaceListItem): WorkspaceIdentity {
    return {
        kind: workspace.workspace.kind,
        path: workspace.workspace.path,
    };
}

function getConversationAppTarget(conversation: CopilotConversationListItem): 'vscode' | 'insiders' {
    const appFamily = getEditorFamily(conversation.instance?.appName);
    return appFamily.key === 'insiders' ? 'insiders' : 'vscode';
}

function matchesOpenState(workspaceOpen: boolean, filter: OpenStateFilter): boolean {
    if (filter === 'all') {
        return true;
    }
    return filter === 'open' ? workspaceOpen : !workspaceOpen;
}

function compareRecentWorkspaceItems(a: CopilotRecentWorkspaceListItem, b: CopilotRecentWorkspaceListItem): number {
    const appOrder: Record<'vscode' | 'insiders', number> = {
        vscode: 0,
        insiders: 1,
    };

    const activityDelta = (b.workspace.lastActivityAt ?? 0) - (a.workspace.lastActivityAt ?? 0);
    if (activityDelta !== 0) {
        return activityDelta;
    }
    const rankDelta = (a.workspace.recentRank ?? Number.MAX_SAFE_INTEGER) - (b.workspace.recentRank ?? Number.MAX_SAFE_INTEGER);
    if (rankDelta !== 0) {
        return rankDelta;
    }
    if (a.workspace.workspaceOpen !== b.workspace.workspaceOpen) {
        return Number(b.workspace.workspaceOpen) - Number(a.workspace.workspaceOpen);
    }
    const appDelta = (appOrder[a.workspace.appTarget] ?? 99) - (appOrder[b.workspace.appTarget] ?? 99);
    if (appDelta !== 0) {
        return appDelta;
    }
    return a.workspace.label.localeCompare(b.workspace.label);
}

function getSessionWorkspaceLabel(session: {
    source: 'workspace' | 'empty-window';
    displayName?: string;
    workspaceFile?: string;
    workspaceDir?: string;
}): string {
    if (session.displayName && session.displayName.trim().length > 0) {
        return session.displayName;
    }
    const workspaceFile = getPathTail(session.workspaceFile);
    if (workspaceFile) {
        return workspaceFile;
    }
    const workspaceDir = getPathTail(session.workspaceDir);
    if (workspaceDir) {
        return workspaceDir;
    }
    return session.source === 'empty-window' ? 'Empty Window' : t('machine.vscodeWorkspace');
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

    const handleOpenFlatConversation = React.useCallback(async (conversation: CopilotFlatConversationListItem) => {
        if (conversation.session.workspaceOpen && conversation.session.instanceId) {
            router.push(
                `/copilot/${encodeURIComponent(conversation.machine.id)}/${encodeURIComponent(conversation.session.instanceId)}/${encodeURIComponent(conversation.session.id)}` as any
            );
            return;
        }

        try {
            const result = await machineOpenVscodeSession(conversation.machine.id, {
                sessionId: conversation.session.id,
                workspaceDir: conversation.session.workspaceDir,
                workspaceFile: conversation.session.workspaceFile,
                newWindow: true,
                appTarget: conversation.session.appTarget,
            });
            if (!result.ok) {
                throw new Error('Failed to open workspace in VS Code.');
            }
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : 'Failed to open workspace in VS Code.'
            );
        }
    }, [router]);

    const handleOpenRecentWorkspace = React.useCallback(async (workspace: CopilotRecentWorkspaceListItem) => {
        try {
            const result = await machineOpenVscodeSession(workspace.machine.id, {
                workspaceDir: workspace.workspace.kind === 'folder' ? workspace.workspace.path : undefined,
                workspaceFile: workspace.workspace.kind === 'workspace-file' ? workspace.workspace.path : undefined,
                newWindow: true,
                appTarget: workspace.workspace.appTarget,
            });
            if (!result.ok) {
                throw new Error('Failed to open workspace in VS Code.');
            }
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : 'Failed to open workspace in VS Code.'
            );
        }
    }, []);

    const handleOpenWorkspaceConversationList = React.useCallback((params: {
        machineId: string;
        groupKey: string;
        appTarget: 'vscode' | 'insiders';
        instanceLabel: string;
        instanceId?: string;
        workspaceDir?: string;
        workspaceFile?: string;
    }) => {
        const routeParams: Record<string, string> = {
            machineId: params.machineId,
            groupKey: params.groupKey,
            appTarget: params.appTarget,
            instanceLabel: params.instanceLabel,
        };
        if (params.instanceId) {
            routeParams.instanceId = params.instanceId;
        }
        if (params.workspaceDir) {
            routeParams.workspaceDir = params.workspaceDir;
        }
        if (params.workspaceFile) {
            routeParams.workspaceFile = params.workspaceFile;
        }

        router.push({
            pathname: '/copilot/workspace',
            params: routeParams,
        } as any);
    }, [router]);

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
                        flatConversations={item.flatConversations}
                        recentWorkspaces={item.recentWorkspaces}
                        onPressConversation={(conversation) => router.push(
                            `/copilot/${encodeURIComponent(conversation.machine.id)}/${encodeURIComponent(conversation.session.instanceId)}/${encodeURIComponent(conversation.session.id)}` as any
                        )}
                        onCreateConversation={handleCreateConversationForInstance}
                        onOpenFlatConversation={handleOpenFlatConversation}
                        onOpenRecentWorkspace={handleOpenRecentWorkspace}
                        onOpenWorkspaceConversationList={handleOpenWorkspaceConversationList}
                    />
                );
        }
    }, [pathname, dataWithSelected, compactSessionView, router, handleCreateConversationForInstance, handleOpenFlatConversation, handleOpenRecentWorkspace, handleOpenWorkspaceConversationList]);


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

const CopilotSessionsGroup = React.memo(({
    conversations,
    flatConversations,
    recentWorkspaces,
    onPressConversation,
    onCreateConversation,
    onOpenFlatConversation,
    onOpenRecentWorkspace,
    onOpenWorkspaceConversationList,
}: {
    conversations: CopilotConversationListItem[];
    flatConversations: CopilotFlatConversationListItem[];
    recentWorkspaces: CopilotRecentWorkspaceListItem[];
    onPressConversation: (conversation: CopilotConversationListItem) => void;
    onCreateConversation: (conversation: CopilotConversationListItem) => Promise<void>;
    onOpenFlatConversation: (conversation: CopilotFlatConversationListItem) => Promise<void>;
    onOpenRecentWorkspace: (workspace: CopilotRecentWorkspaceListItem) => Promise<void>;
    onOpenWorkspaceConversationList: (params: {
        machineId: string;
        groupKey: string;
        appTarget: 'vscode' | 'insiders';
        instanceLabel: string;
        instanceId?: string;
        workspaceDir?: string;
        workspaceFile?: string;
    }) => void;
}) => {
    const styles = stylesheet;
    const [showRecent, setShowRecent] = React.useState(true);
    const [sessionViewMode, setSessionViewMode] = React.useState<'grouped' | 'flat'>('grouped');
    const [viewModeSwitchingTo, setViewModeSwitchingTo] = React.useState<'grouped' | 'flat' | null>(null);
    const [openStateFilter, setOpenStateFilter] = React.useState<OpenStateFilter>('all');
    const [collapsedByInstance, setCollapsedByInstance] = React.useState<Record<string, boolean>>({});
    const [searchByInstance, setSearchByInstance] = React.useState<Record<string, string>>({});
    const [creatingByInstance, setCreatingByInstance] = React.useState<Record<string, boolean>>({});
    const [openingWorkspaceByGroup, setOpeningWorkspaceByGroup] = React.useState<Record<string, number>>({});
    const [topSearchQuery, setTopSearchQuery] = React.useState('');
    const [searchLoading, setSearchLoading] = React.useState(false);
    const [searchError, setSearchError] = React.useState<string | null>(null);
    const [searchedFlatConversations, setSearchedFlatConversations] = React.useState<CopilotFlatConversationListItem[]>([]);
    const [searchedRecentWorkspaces, setSearchedRecentWorkspaces] = React.useState<CopilotRecentWorkspaceListItem[]>([]);
    const trimmedTopSearch = topSearchQuery.trim();
    const recentCutoff = Date.now() - RECENT_WINDOW_MS;

    const groupedConversationsByMachine = React.useMemo(() => {
        type TreeInstanceGroup = {
            key: string;
            instanceLabel: string;
            instanceLastResponse: number;
            workspaceOpen: boolean;
            conversations: CopilotConversationListItem[];
            workspace: CopilotRecentWorkspaceListItem | null;
        };
        type TreeAppGroup = {
            key: 'vscode' | 'insiders' | 'other';
            label: string;
            appLastResponse: number;
            instances: Map<string, TreeInstanceGroup>;
        };
        type TreeMachineGroup = {
            key: string;
            machineName: string;
            machineLastResponse: number;
            apps: Map<'vscode' | 'insiders' | 'other', TreeAppGroup>;
        };

        const recentCutoff = Date.now() - RECENT_WINDOW_MS;
        const recentWorkspaceSource = showRecent
            ? (trimmedTopSearch.length > 0 ? searchedRecentWorkspaces : recentWorkspaces)
            : [];

        const recentFilteredConversations = conversations.filter((conversation) => {
            if (!matchesOpenState(true, openStateFilter)) {
                return false;
            }
            if (!showRecent) {
                return true;
            }
            return (conversation.session.lastMessageDate ?? 0) >= recentCutoff;
        });

        const recentFilteredWorkspaces = recentWorkspaceSource.filter((workspace) => {
            if (!matchesOpenState(workspace.workspace.workspaceOpen, openStateFilter)) {
                return false;
            }
            if (!showRecent) {
                return false;
            }
            if (workspace.workspace.workspaceOpen) {
                return true;
            }
            return (workspace.workspace.lastActivityAt ?? 0) >= recentCutoff;
        });

        const machineGroups = new Map<string, TreeMachineGroup>();
        const groupsByInstanceId = new Map<string, TreeInstanceGroup>();
        const groupsByWorkspacePath = new Map<string, TreeInstanceGroup>();

        const ensureMachineGroup = (machine: CopilotConversationListItem['machine']): TreeMachineGroup => {
            const machineName = machine.metadata?.displayName || machine.metadata?.host || machine.id;
            const existing = machineGroups.get(machine.id);
            if (existing) {
                return existing;
            }
            const created: TreeMachineGroup = {
                key: machine.id,
                machineName,
                machineLastResponse: 0,
                apps: new Map<'vscode' | 'insiders' | 'other', TreeAppGroup>(),
            };
            machineGroups.set(machine.id, created);
            return created;
        };

        const ensureAppGroup = (
            machineGroup: TreeMachineGroup,
            appFamily: { key: 'vscode' | 'insiders' | 'other'; label: string }
        ): TreeAppGroup => {
            const existing = machineGroup.apps.get(appFamily.key);
            if (existing) {
                return existing;
            }
            const created: TreeAppGroup = {
                key: appFamily.key,
                label: appFamily.label,
                appLastResponse: 0,
                instances: new Map<string, TreeInstanceGroup>(),
            };
            machineGroup.apps.set(appFamily.key, created);
            return created;
        };

        const createInstanceGroup = (
            appGroup: TreeAppGroup,
            groupKey: string,
            instanceLabel: string
        ): TreeInstanceGroup => {
            const created: TreeInstanceGroup = {
                key: groupKey,
                instanceLabel,
                instanceLastResponse: 0,
                workspaceOpen: false,
                conversations: [],
                workspace: null,
            };
            appGroup.instances.set(groupKey, created);
            return created;
        };

        recentFilteredConversations.forEach((conversation) => {
            const machineGroup = ensureMachineGroup(conversation.machine);
            const appFamily = getEditorFamily(conversation.instance?.appName);
            const appGroup = ensureAppGroup(machineGroup, appFamily);
            const appTarget = getConversationAppTarget(conversation);
            const workspaceIdentity = getWorkspaceIdentityFromConversation(conversation);
            const workspacePathKey = workspaceIdentity
                ? buildWorkspacePathKey(conversation.machine.id, appTarget, workspaceIdentity)
                : null;
            const instanceIdKey = `${conversation.machine.id}:instance:${conversation.session.instanceId}`;

            const existing = groupsByInstanceId.get(instanceIdKey)
                ?? (workspacePathKey ? groupsByWorkspacePath.get(workspacePathKey) : undefined);

            const instanceGroup = existing ?? createInstanceGroup(
                appGroup,
                workspacePathKey ?? instanceIdKey,
                workspaceIdentity ? getPathTail(workspaceIdentity.path) || getInstanceLabel(conversation) : getInstanceLabel(conversation),
            );

            const lastResponseAt = conversation.session.lastMessageDate || conversation.instance?.lastSeen || 0;
            instanceGroup.conversations.push(conversation);
            instanceGroup.workspaceOpen = true;
            instanceGroup.instanceLastResponse = Math.max(instanceGroup.instanceLastResponse, lastResponseAt);
            if (!instanceGroup.instanceLabel || instanceGroup.instanceLabel.startsWith('Window ')) {
                instanceGroup.instanceLabel = workspaceIdentity
                    ? getPathTail(workspaceIdentity.path) || getInstanceLabel(conversation)
                    : getInstanceLabel(conversation);
            }
            machineGroup.machineLastResponse = Math.max(machineGroup.machineLastResponse, lastResponseAt);
            appGroup.appLastResponse = Math.max(appGroup.appLastResponse, lastResponseAt);

            groupsByInstanceId.set(instanceIdKey, instanceGroup);
            if (workspacePathKey) {
                groupsByWorkspacePath.set(workspacePathKey, instanceGroup);
            }
        });

        recentFilteredWorkspaces.forEach((workspace) => {
            const machineGroup = ensureMachineGroup(workspace.machine);
            const appFamily = getEditorFamily(workspace.workspace.appName);
            const appGroup = ensureAppGroup(machineGroup, appFamily);
            const workspaceIdentity = getWorkspaceIdentityFromRecentWorkspace(workspace);
            const workspacePathKey = buildWorkspacePathKey(workspace.machine.id, workspace.workspace.appTarget, workspaceIdentity);
            const instanceIdKey = workspace.workspace.instanceId ? `${workspace.machine.id}:instance:${workspace.workspace.instanceId}` : null;

            const existing = (instanceIdKey ? groupsByInstanceId.get(instanceIdKey) : undefined)
                ?? groupsByWorkspacePath.get(workspacePathKey);

            const instanceGroup = existing ?? createInstanceGroup(
                appGroup,
                workspacePathKey,
                workspace.workspace.label || getPathTail(workspace.workspace.path),
            );

            const activityAt = workspace.workspace.lastActivityAt ?? 0;
            instanceGroup.workspace = workspace;
            instanceGroup.workspaceOpen = instanceGroup.workspaceOpen || workspace.workspace.workspaceOpen;
            instanceGroup.instanceLastResponse = Math.max(instanceGroup.instanceLastResponse, activityAt);
            if (!instanceGroup.instanceLabel || instanceGroup.instanceLabel.startsWith('Window ')) {
                instanceGroup.instanceLabel = workspace.workspace.label || getPathTail(workspace.workspace.path);
            }
            machineGroup.machineLastResponse = Math.max(machineGroup.machineLastResponse, activityAt);
            appGroup.appLastResponse = Math.max(appGroup.appLastResponse, activityAt);

            if (instanceIdKey) {
                groupsByInstanceId.set(instanceIdKey, instanceGroup);
            }
            groupsByWorkspacePath.set(workspacePathKey, instanceGroup);
        });

        const appOrder: Record<'vscode' | 'insiders' | 'other', number> = {
            vscode: 0,
            insiders: 1,
            other: 2,
        };

        const normalized = Array.from(machineGroups.values()).map((machineGroup) => {
            const apps = Array.from(machineGroup.apps.values()).map((appGroup) => {
                const instances = Array.from(appGroup.instances.values());
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
                instances.sort((a, b) => {
                    if (a.workspaceOpen !== b.workspaceOpen) {
                        return Number(b.workspaceOpen) - Number(a.workspaceOpen);
                    }
                    return b.instanceLastResponse - a.instanceLastResponse;
                });

                return {
                    key: appGroup.key,
                    label: appGroup.label,
                    appLastResponse: appGroup.appLastResponse,
                    instances,
                };
            });

            apps.sort((a, b) => {
                const orderDelta = (appOrder[a.key] ?? 999) - (appOrder[b.key] ?? 999);
                if (orderDelta !== 0) {
                    return orderDelta;
                }
                return b.appLastResponse - a.appLastResponse;
            });

            return {
                key: machineGroup.key,
                machineName: machineGroup.machineName,
                machineLastResponse: machineGroup.machineLastResponse,
                apps,
            };
        });

        normalized.sort((a, b) => {
            const responseDelta = b.machineLastResponse - a.machineLastResponse;
            if (responseDelta !== 0) {
                return responseDelta;
            }
            return a.machineName.localeCompare(b.machineName);
        });

        return normalized;
    }, [
        conversations,
        showRecent,
        trimmedTopSearch,
        searchedRecentWorkspaces,
        recentWorkspaces,
        openStateFilter,
    ]);

    const machinesById = React.useMemo(() => {
        const byId = new Map<string, CopilotConversationListItem['machine']>();
        conversations.forEach((conversation) => {
            byId.set(conversation.machine.id, conversation.machine);
        });
        flatConversations.forEach((conversation) => {
            byId.set(conversation.machine.id, conversation.machine);
        });
        recentWorkspaces.forEach((workspace) => {
            byId.set(workspace.machine.id, workspace.machine);
        });
        return byId;
    }, [conversations, flatConversations, recentWorkspaces]);

    const modeMachineIds = React.useMemo(() => {
        const flat = Array.from(new Set(flatConversations.map((conversation) => conversation.machine.id)));
        const recent = Array.from(new Set(recentWorkspaces.map((workspace) => workspace.machine.id)));
        return { flat, recent };
    }, [flatConversations, recentWorkspaces]);

    React.useEffect(() => {
        const canSearch = trimmedTopSearch.length > 0 && (showRecent || sessionViewMode === 'flat');
        if (!canSearch) {
            setSearchLoading(false);
            setSearchError(null);
            setSearchedFlatConversations([]);
            setSearchedRecentWorkspaces([]);
            return;
        }

        const entity: 'sessions' | 'workspaces' | 'both' = showRecent
            ? (sessionViewMode === 'flat' ? 'both' : 'workspaces')
            : 'sessions';

        let cancelled = false;
        const timeout = setTimeout(async () => {
            const preferredIds = entity === 'workspaces'
                ? modeMachineIds.recent
                : entity === 'sessions'
                    ? modeMachineIds.flat
                    : Array.from(new Set([...modeMachineIds.flat, ...modeMachineIds.recent]));
            const machineIds = preferredIds.length > 0 ? preferredIds : Array.from(machinesById.keys());
            if (machineIds.length === 0) {
                if (!cancelled) {
                    setSearchLoading(false);
                    setSearchError(null);
                    setSearchedFlatConversations([]);
                    setSearchedRecentWorkspaces([]);
                }
                return;
            }

            setSearchLoading(true);
            setSearchError(null);

            const flatByKey = new Map<string, CopilotFlatConversationListItem>();
            const recentByKey = new Map<string, CopilotRecentWorkspaceListItem>();
            let successCount = 0;
            let errorCount = 0;

            await Promise.all(machineIds.map(async (machineId) => {
                const machine = machinesById.get(machineId);
                if (!machine) {
                    return;
                }

                try {
                    const result = await machineSearch(machineId, {
                        query: trimmedTopSearch,
                        entity,
                        includeOpen: openStateFilter !== 'closed',
                        includeClosed: openStateFilter !== 'open',
                        source: {
                            live: true,
                            disk: true,
                        },
                        limit: 250,
                    });
                    successCount++;

                    if (entity === 'sessions' || entity === 'both') {
                        for (const session of result.flatSessions ?? []) {
                            const dedupeKey = `${machine.id}:${session.appTarget}:${session.id}:${session.jsonPath}`;
                            const next: CopilotFlatConversationListItem = {
                                machine,
                                instance: null,
                                session,
                            };
                            const existing = flatByKey.get(dedupeKey);
                            if (!existing) {
                                flatByKey.set(dedupeKey, next);
                                continue;
                            }
                            if (existing.session.workspaceOpen !== next.session.workspaceOpen) {
                                if (next.session.workspaceOpen) {
                                    flatByKey.set(dedupeKey, next);
                                }
                                continue;
                            }
                            if (existing.session.needsInput !== next.session.needsInput) {
                                if (next.session.needsInput) {
                                    flatByKey.set(dedupeKey, next);
                                }
                                continue;
                            }
                            if ((next.session.lastMessageDate ?? 0) > (existing.session.lastMessageDate ?? 0)) {
                                flatByKey.set(dedupeKey, next);
                            }
                        }
                    }

                    if (entity === 'workspaces' || entity === 'both') {
                        for (const workspace of result.recentWorkspaces ?? []) {
                            const dedupeKey = `${machine.id}:${workspace.appTarget}:${workspace.kind}:${workspace.path}`;
                            const next: CopilotRecentWorkspaceListItem = {
                                machine,
                                instance: null,
                                workspace,
                            };
                            const existing = recentByKey.get(dedupeKey);
                            if (!existing) {
                                recentByKey.set(dedupeKey, next);
                                continue;
                            }
                            const existingActivity = existing.workspace.lastActivityAt ?? 0;
                            const nextActivity = next.workspace.lastActivityAt ?? 0;
                            const existingRank = existing.workspace.recentRank ?? Number.MAX_SAFE_INTEGER;
                            const nextRank = next.workspace.recentRank ?? Number.MAX_SAFE_INTEGER;
                            if (!existing.workspace.workspaceOpen && next.workspace.workspaceOpen) {
                                recentByKey.set(dedupeKey, next);
                                continue;
                            }
                            if (nextActivity > existingActivity) {
                                recentByKey.set(dedupeKey, next);
                                continue;
                            }
                            if (nextActivity === existingActivity && nextRank < existingRank) {
                                recentByKey.set(dedupeKey, next);
                            }
                        }
                    }
                } catch {
                    errorCount++;
                }
            }));

            if (cancelled) {
                return;
            }

            const nextFlat = Array.from(flatByKey.values()).sort((a, b) => {
                if (a.session.workspaceOpen !== b.session.workspaceOpen) {
                    return Number(b.session.workspaceOpen) - Number(a.session.workspaceOpen);
                }
                if (a.session.needsInput !== b.session.needsInput) {
                    return Number(b.session.needsInput) - Number(a.session.needsInput);
                }
                return (b.session.lastMessageDate ?? 0) - (a.session.lastMessageDate ?? 0);
            });
            const nextRecent = Array.from(recentByKey.values()).sort((a, b) => {
                return compareRecentWorkspaceItems(a, b);
            });

            setSearchedFlatConversations(nextFlat);
            setSearchedRecentWorkspaces(nextRecent);
            setSearchError(successCount === 0 && errorCount > 0 ? 'Cannot reach machine daemon right now.' : null);
            setSearchLoading(false);
        }, 280);

        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [trimmedTopSearch, showRecent, sessionViewMode, openStateFilter, machinesById, modeMachineIds]);

    const effectiveFlatConversations = React.useMemo(
        () => (sessionViewMode === 'flat' && trimmedTopSearch.length > 0 ? searchedFlatConversations : flatConversations),
        [sessionViewMode, trimmedTopSearch, searchedFlatConversations, flatConversations]
    );

    const effectiveRecentWorkspaces = React.useMemo(
        () => (showRecent && trimmedTopSearch.length > 0 ? searchedRecentWorkspaces : recentWorkspaces),
        [showRecent, trimmedTopSearch, searchedRecentWorkspaces, recentWorkspaces]
    );

    const filteredFlatConversations = React.useMemo(
        () => effectiveFlatConversations.filter((conversation) => matchesOpenState(conversation.session.workspaceOpen, openStateFilter)),
        [effectiveFlatConversations, openStateFilter]
    );

    const flatList = React.useMemo(() => {
        return [...filteredFlatConversations].sort((a, b) => {
            if (a.session.workspaceOpen !== b.session.workspaceOpen) {
                return Number(b.session.workspaceOpen) - Number(a.session.workspaceOpen);
            }
            if (a.session.needsInput !== b.session.needsInput) {
                return Number(b.session.needsInput) - Number(a.session.needsInput);
            }
            const dateDelta = (b.session.lastMessageDate ?? 0) - (a.session.lastMessageDate ?? 0);
            if (dateDelta !== 0) {
                return dateDelta;
            }
            return a.session.title.localeCompare(b.session.title);
        });
    }, [filteredFlatConversations]);

    const filteredRecentWorkspaces = React.useMemo(
        () => effectiveRecentWorkspaces.filter((workspace) => {
            if (!matchesOpenState(workspace.workspace.workspaceOpen, openStateFilter)) {
                return false;
            }
            if (!showRecent) {
                return true;
            }
            if (workspace.workspace.workspaceOpen) {
                return true;
            }
            return (workspace.workspace.lastActivityAt ?? 0) >= recentCutoff;
        }),
        [effectiveRecentWorkspaces, openStateFilter, showRecent, recentCutoff]
    );

    const groupedFlatConversationsByKey = React.useMemo(() => {
        const byKey = new Map<string, CopilotFlatConversationListItem[]>();

        flatConversations.forEach((conversation) => {
            const keys = new Set<string>();
            const workspaceIdentity = getWorkspaceIdentityFromFlatConversation(conversation);
            if (workspaceIdentity) {
                keys.add(buildWorkspacePathKey(
                    conversation.machine.id,
                    conversation.session.appTarget,
                    workspaceIdentity
                ));
            }
            if (conversation.session.instanceId) {
                keys.add(`${conversation.machine.id}:instance:${conversation.session.instanceId}`);
            }
            if (keys.size === 0) {
                return;
            }
            keys.forEach((key) => {
                const existing = byKey.get(key) ?? [];
                const dedupeKey = `${conversation.machine.id}:${conversation.session.appTarget}:${conversation.session.id}:${conversation.session.jsonPath}`;
                const alreadyExists = existing.some((item) => {
                    const existingKey = `${item.machine.id}:${item.session.appTarget}:${item.session.id}:${item.session.jsonPath}`;
                    return existingKey === dedupeKey;
                });
                if (alreadyExists) {
                    return;
                }
                existing.push(conversation);
                byKey.set(key, existing);
            });
        });

        byKey.forEach((items, key) => {
            const sorted = [...items].sort((a, b) => {
                if (a.session.workspaceOpen !== b.session.workspaceOpen) {
                    return Number(b.session.workspaceOpen) - Number(a.session.workspaceOpen);
                }
                if (a.session.needsInput !== b.session.needsInput) {
                    return Number(b.session.needsInput) - Number(a.session.needsInput);
                }
                return (b.session.lastMessageDate ?? 0) - (a.session.lastMessageDate ?? 0);
            });
            byKey.set(key, sorted);
        });

        return byKey;
    }, [flatConversations]);

    const recentList = React.useMemo(() => {
        return [...filteredRecentWorkspaces].sort((a, b) => compareRecentWorkspaceItems(a, b));
    }, [filteredRecentWorkspaces]);

    React.useEffect(() => {
        const instanceKeys = new Set<string>();
        groupedConversationsByMachine.forEach((machineGroup) => {
            machineGroup.apps.forEach((appGroup) => {
                appGroup.instances.forEach((group) => {
                    instanceKeys.add(group.key);
                });
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
    }, [groupedConversationsByMachine]);

    const groupedInstanceByKey = React.useMemo(() => {
        const byKey = new Map<string, {
            key: string;
            workspaceOpen: boolean;
            conversations: CopilotConversationListItem[];
            workspace: CopilotRecentWorkspaceListItem | null;
        }>();
        groupedConversationsByMachine.forEach((machineGroup) => {
            machineGroup.apps.forEach((appGroup) => {
                appGroup.instances.forEach((group) => {
                    byKey.set(group.key, {
                        key: group.key,
                        workspaceOpen: group.workspaceOpen,
                        conversations: group.conversations,
                        workspace: group.workspace,
                    });
                });
            });
        });
        return byKey;
    }, [groupedConversationsByMachine]);

    React.useEffect(() => {
        if (!viewModeSwitchingTo) {
            return;
        }
        const timeout = setTimeout(() => {
            setViewModeSwitchingTo(null);
        }, 420);
        return () => clearTimeout(timeout);
    }, [viewModeSwitchingTo, sessionViewMode]);

    React.useEffect(() => {
        if (Object.keys(openingWorkspaceByGroup).length === 0) {
            return;
        }

        const now = Date.now();
        const readyToExpand: string[] = [];
        const stale: string[] = [];
        for (const [groupKey, startedAt] of Object.entries(openingWorkspaceByGroup)) {
            const group = groupedInstanceByKey.get(groupKey);
            if (group && group.workspaceOpen && group.conversations.length > 0) {
                readyToExpand.push(groupKey);
                continue;
            }
            if (now - startedAt > 15000) {
                stale.push(groupKey);
            }
        }

        if (readyToExpand.length === 0 && stale.length === 0) {
            return;
        }

        const doneSet = new Set<string>([...readyToExpand, ...stale]);
        setOpeningWorkspaceByGroup((previous) => {
            const next = { ...previous };
            doneSet.forEach((key) => {
                delete next[key];
            });
            return next;
        });
        if (readyToExpand.length > 0) {
            setCollapsedByInstance((previous) => {
                const next = { ...previous };
                readyToExpand.forEach((key) => {
                    next[key] = false;
                });
                return next;
            });
        }
    }, [openingWorkspaceByGroup, groupedInstanceByKey]);

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

    const handleSessionViewModeChange = React.useCallback((nextMode: 'grouped' | 'flat') => {
        if (nextMode === sessionViewMode) {
            return;
        }
        setViewModeSwitchingTo(nextMode);
        setSessionViewMode(nextMode);
    }, [sessionViewMode]);

    const handleGroupHeaderPress = React.useCallback(async (group: {
        key: string;
        workspaceOpen: boolean;
        workspace: CopilotRecentWorkspaceListItem | null;
    }) => {
        if (group.workspaceOpen || !group.workspace) {
            toggleCollapsed(group.key);
            return;
        }

        setOpeningWorkspaceByGroup((previous) => ({
            ...previous,
            [group.key]: Date.now(),
        }));

        await onOpenRecentWorkspace(group.workspace);
    }, [onOpenRecentWorkspace, toggleCollapsed]);

    const showTopSearch = showRecent || sessionViewMode === 'flat';
    const topSearchPlaceholder = showRecent
        ? (sessionViewMode === 'flat' ? 'Search sessions and recent workspaces' : 'Search recent workspaces')
        : 'Search sessions';
    const openStateOptions: { value: OpenStateFilter; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed' },
    ];

    return (
        <View>
            <View style={styles.copilotViewSwitchRow}>
                <Pressable
                    style={[
                        styles.copilotRecentToggleButton,
                        showRecent && styles.copilotRecentToggleButtonActive
                    ]}
                    onPress={() => setShowRecent((previous) => !previous)}
                >
                    <Text
                        style={[
                            styles.copilotRecentToggleText,
                            showRecent && styles.copilotRecentToggleTextActive
                        ]}
                    >
                        Recent
                    </Text>
                </Pressable>
                <View style={styles.copilotSessionModeSelector}>
                    <Pressable
                        style={[
                            styles.copilotSessionModeButton,
                            sessionViewMode === 'flat' && styles.copilotSessionModeButtonActive,
                            viewModeSwitchingTo === 'flat' && styles.copilotSessionModeButtonLoading
                        ]}
                        onPress={() => handleSessionViewModeChange('flat')}
                    >
                        {viewModeSwitchingTo === 'flat' ? (
                            <ActivityIndicator size="small" color="#7C7C7C" />
                        ) : (
                            <NativeText
                                style={[
                                    styles.copilotSessionModeIcon,
                                    sessionViewMode === 'flat' && styles.copilotSessionModeIconActive
                                ]}
                            >
                                {CODICON_GLYPHS.flat}
                            </NativeText>
                        )}
                    </Pressable>
                    <Pressable
                        style={[
                            styles.copilotSessionModeButton,
                            sessionViewMode === 'grouped' && styles.copilotSessionModeButtonActive,
                            viewModeSwitchingTo === 'grouped' && styles.copilotSessionModeButtonLoading
                        ]}
                        onPress={() => handleSessionViewModeChange('grouped')}
                    >
                        {viewModeSwitchingTo === 'grouped' ? (
                            <ActivityIndicator size="small" color="#7C7C7C" />
                        ) : (
                            <NativeText
                                style={[
                                    styles.copilotSessionModeIcon,
                                    sessionViewMode === 'grouped' && styles.copilotSessionModeIconActive
                                ]}
                            >
                                {CODICON_GLYPHS.tree}
                            </NativeText>
                        )}
                    </Pressable>
                </View>
            </View>

            <View style={styles.copilotOpenStateFilterRow}>
                <View style={styles.copilotOpenStateSelector}>
                    {openStateOptions.map((option) => (
                        <Pressable
                            key={option.value}
                            style={[
                                styles.copilotOpenStateButton,
                                openStateFilter === option.value && styles.copilotOpenStateButtonActive
                            ]}
                            onPress={() => setOpenStateFilter(option.value)}
                        >
                            <Text
                                style={[
                                    styles.copilotOpenStateText,
                                    openStateFilter === option.value && styles.copilotOpenStateTextActive
                                ]}
                            >
                                {option.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>

            {showTopSearch && (
                <View style={styles.copilotTopSearchContainer}>
                    <View style={styles.copilotTopSearchInputRow}>
                        <Ionicons name="search" size={14} color="#8A8A8A" />
                        <TextInput
                            value={topSearchQuery}
                            onChangeText={setTopSearchQuery}
                            placeholder={topSearchPlaceholder}
                            placeholderTextColor="#9C9C9C"
                            style={styles.copilotTopSearchInput}
                        />
                        {searchLoading && trimmedTopSearch.length > 0 && (
                            <ActivityIndicator size="small" color="#7C7C7C" />
                        )}
                    </View>
                    {searchError && trimmedTopSearch.length > 0 && (
                        <Text style={styles.copilotTopSearchError}>
                            {searchError}
                        </Text>
                    )}
                </View>
            )}

            {sessionViewMode === 'grouped' && groupedConversationsByMachine.map((machineGroup) => (
                <View key={machineGroup.key}>
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {machineGroup.machineName}
                        </Text>
                    </View>
                    <View style={styles.copilotCard}>
                        {machineGroup.apps.map((appGroup, appIndex) => (
                            <View key={`${machineGroup.key}:${appGroup.key}`}>
                                <View style={styles.copilotMachineHeader}>
                                    <Text style={styles.copilotMachineTitle} numberOfLines={1}>
                                        {appGroup.label}
                                    </Text>
                                </View>
                                {appGroup.instances.map((group, groupIndex) => {
                                    const isCollapsed = true;
                                    const search = (searchByInstance[group.key] ?? '').trim().toLowerCase();
                                    const liveConversationKeys = new Set<string>();
                                    group.conversations.forEach((conversation) => {
                                        liveConversationKeys.add(`${conversation.machine.id}:${conversation.session.id}:${conversation.session.jsonPath}`);
                                    });
                                    const fallbackFlatConversations = (groupedFlatConversationsByKey.get(group.key) ?? []).filter((conversation) => {
                                        const liveKey = `${conversation.machine.id}:${conversation.session.id}:${conversation.session.jsonPath}`;
                                        if (liveConversationKeys.has(liveKey)) {
                                            return false;
                                        }
                                        if (openStateFilter !== 'all' && !matchesOpenState(conversation.session.workspaceOpen, openStateFilter)) {
                                            return false;
                                        }
                                        if (showRecent && !group.workspaceOpen) {
                                            return (conversation.session.lastMessageDate ?? 0) >= recentCutoff;
                                        }
                                        return true;
                                    });
                                    const conversationRows: Array<
                                        | { kind: 'live'; key: string; conversation: CopilotConversationListItem; title: string; needsInput: boolean; lastResponseAt: number }
                                        | { kind: 'flat'; key: string; conversation: CopilotFlatConversationListItem; title: string; needsInput: boolean; lastResponseAt: number }
                                    > = [
                                        ...group.conversations.map((conversation) => ({
                                            kind: 'live' as const,
                                            key: `${conversation.machine.id}:${conversation.session.instanceId}:${conversation.session.id}:${conversation.session.jsonPath}`,
                                            conversation,
                                            title: conversation.session.title,
                                            needsInput: conversation.session.needsInput,
                                            lastResponseAt: conversation.session.lastMessageDate ?? 0,
                                        })),
                                        ...fallbackFlatConversations.map((conversation) => ({
                                            kind: 'flat' as const,
                                            key: `${conversation.machine.id}:${conversation.session.appTarget}:${conversation.session.id}:${conversation.session.jsonPath}`,
                                            conversation,
                                            title: conversation.session.title,
                                            needsInput: conversation.session.needsInput,
                                            lastResponseAt: conversation.session.lastMessageDate ?? 0,
                                        })),
                                    ];
                                    const visibleConversationRows = search.length === 0
                                        ? conversationRows
                                        : conversationRows.filter((row) => row.title.toLowerCase().includes(search));
                                    const isOpeningWorkspace = false;
                                    const seedConversation = group.conversations[0] ?? null;
                                    const seedFallbackConversation = fallbackFlatConversations[0] ?? null;
                                    const appTargetForGroup: 'vscode' | 'insiders' = group.workspace?.workspace.appTarget
                                        ?? (seedConversation
                                            ? getConversationAppTarget(seedConversation)
                                            : (seedFallbackConversation?.session.appTarget ?? (appGroup.key === 'insiders' ? 'insiders' : 'vscode')));
                                    const workspaceFileForGroup = group.workspace?.workspace.kind === 'workspace-file'
                                        ? group.workspace.workspace.path
                                        : (seedConversation?.session.workspaceFile ?? seedFallbackConversation?.session.workspaceFile);
                                    const workspaceDirForGroup = group.workspace?.workspace.kind === 'folder'
                                        ? group.workspace.workspace.path
                                        : (seedConversation?.session.workspaceDir ?? seedFallbackConversation?.session.workspaceDir);
                                    const instanceIdForGroup = group.workspace?.workspace.instanceId
                                        ?? seedConversation?.session.instanceId
                                        ?? seedFallbackConversation?.session.instanceId;
                                    const totalConversationCount = conversationRows.length;
                                    const canSearchConversations = group.workspaceOpen && totalConversationCount > 0;
                                    const conversationCountLabel = `${totalConversationCount} conversation${totalConversationCount === 1 ? '' : 's'}`;
                                    const lastResponseLabel = group.instanceLastResponse > 0
                                        ? formatLastSeen(group.instanceLastResponse, false)
                                        : 'none';
                                    const subtitleText = !group.workspaceOpen
                                        ? (isOpeningWorkspace ? 'Opening workspace…' : 'Closed • Tap to open')
                                        : (totalConversationCount > 0
                                            ? `${conversationCountLabel} • Last response ${lastResponseLabel}`
                                            : (isOpeningWorkspace
                                                ? 'Opening workspace…'
                                                : (showRecent ? 'No recent conversations' : 'No conversations available')));
                                    const isLastInstanceInApp = groupIndex === appGroup.instances.length - 1;
                                    const isLastAppInMachine = appIndex === machineGroup.apps.length - 1;

                                    return (
                                        <View key={`${machineGroup.key}:${appGroup.key}:${group.key}`}>
                                            <View
                                                style={[
                                                    styles.copilotInstanceHeader,
                                                    appIndex === 0 && groupIndex === 0 && styles.copilotInstanceHeaderFirst
                                                ]}
                                            >
                                                <Pressable
                                                    style={styles.copilotInstanceHeaderPressable}
                                                    onPress={() => {
                                                        onOpenWorkspaceConversationList({
                                                            machineId: machineGroup.key,
                                                            groupKey: group.key,
                                                            appTarget: appTargetForGroup,
                                                            instanceLabel: group.instanceLabel,
                                                            instanceId: instanceIdForGroup,
                                                            workspaceDir: workspaceDirForGroup,
                                                            workspaceFile: workspaceFileForGroup,
                                                        });
                                                    }}
                                                >
                                                    <View style={styles.copilotInstanceMain}>
                                                        <View style={styles.copilotInstanceTitleRow}>
                                                            {group.workspaceOpen && (
                                                                <StatusDot color="#34C759" size={8} style={styles.copilotInstanceOpenDot} />
                                                            )}
                                                            <Text style={styles.copilotInstanceTitle} numberOfLines={1}>
                                                                {group.instanceLabel}
                                                            </Text>
                                                            <Ionicons
                                                                name="chevron-forward"
                                                                size={14}
                                                                color="#7C7C7C"
                                                                style={styles.copilotInstanceChevron}
                                                            />
                                                        </View>
                                                        <Text style={styles.copilotInstanceSubtitle} numberOfLines={2}>
                                                            {subtitleText}
                                                        </Text>
                                                    </View>
                                                </Pressable>
                                            </View>

                                            {!isCollapsed && (
                                                <>
                                                    {canSearchConversations && (
                                                        <View style={styles.copilotSearchContainer}>
                                                            <TextInput
                                                                value={searchByInstance[group.key] ?? ''}
                                                                onChangeText={(value) => handleSearchChange(group.key, value)}
                                                                placeholder="Search conversations"
                                                                placeholderTextColor="#9C9C9C"
                                                                style={styles.copilotSearchInput}
                                                            />
                                                        </View>
                                                    )}
                                                    {totalConversationCount === 0 && (
                                                        <View style={styles.copilotEmptySearchRow}>
                                                            <Text style={styles.copilotEmptySearchText}>
                                                                {group.workspaceOpen
                                                                    ? (isOpeningWorkspace
                                                                        ? 'Opening workspace…'
                                                                        : (showRecent ? 'No recent conversations' : 'No conversations available'))
                                                                    : 'Closed workspace'}
                                                            </Text>
                                                        </View>
                                                    )}
                                                    {canSearchConversations && visibleConversationRows.length === 0 && (
                                                        <View style={styles.copilotEmptySearchRow}>
                                                            <Text style={styles.copilotEmptySearchText}>
                                                                No matching conversations
                                                            </Text>
                                                        </View>
                                                    )}
                                                    {canSearchConversations && visibleConversationRows.map((row, index) => {
                                                        const statusText = row.needsInput
                                                            ? t('machine.vscodeNeedsInput')
                                                            : (row.lastResponseAt > 0
                                                                ? `Last response ${formatLastSeen(row.lastResponseAt, false)}`
                                                                : 'No responses yet');
                                                        const statusColor = row.needsInput ? '#FF3B30' : '#888888';
                                                        const isLastInGroup = index === visibleConversationRows.length - 1;
                                                        const isLastGroup = isLastInGroup && isLastInstanceInApp && isLastAppInMachine;

                                                        return (
                                                            <Pressable
                                                                key={row.key}
                                                                style={[
                                                                    styles.copilotRow,
                                                                    !isLastGroup && styles.copilotRowBorder
                                                                ]}
                                                                onPress={() => {
                                                                    if (row.kind === 'live') {
                                                                        onPressConversation(row.conversation);
                                                                        return;
                                                                    }
                                                                    void onOpenFlatConversation(row.conversation);
                                                                }}
                                                            >
                                                                <View style={styles.copilotIconContainer}>
                                                                    <Ionicons
                                                                        name={row.needsInput ? 'alert-circle' : 'logo-github'}
                                                                        size={18}
                                                                        color={row.needsInput ? '#FF3B30' : '#4A5568'}
                                                                    />
                                                                </View>
                                                                <View style={styles.copilotContent}>
                                                                    <View style={styles.copilotTitleRow}>
                                                                        <Text style={styles.copilotTitle} numberOfLines={1}>
                                                                            {row.title}
                                                                        </Text>
                                                                    </View>
                                                                    <View style={styles.copilotStatusRow}>
                                                                        {row.needsInput && (
                                                                            <StatusDot color={statusColor} isPulsing />
                                                                        )}
                                                                        <Text
                                                                            style={[
                                                                                styles.copilotStatusText,
                                                                                {
                                                                                    color: statusColor,
                                                                                    marginLeft: row.needsInput ? 4 : 0
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
                                            {!isLastInstanceInApp && (
                                                <View style={styles.copilotInstanceSeparator} />
                                            )}
                                        </View>
                                    );
                                })}
                                {appIndex < machineGroup.apps.length - 1 && (
                                    <View style={styles.copilotInstanceSeparator} />
                                )}
                            </View>
                        ))}
                    </View>
                </View>
            ))}

            {sessionViewMode === 'flat' && flatList.length > 0 && (
                <View style={styles.copilotCard}>
                    {flatList.map((conversation, index) => {
                        const machineName = conversation.machine.metadata?.displayName
                            || conversation.machine.metadata?.host
                            || conversation.machine.id;
                        const workspaceLabel = getSessionWorkspaceLabel(conversation.session);
                        const lastResponseAt = conversation.session.lastMessageDate ?? 0;
                        const statusText = conversation.session.needsInput
                            ? t('machine.vscodeNeedsInput')
                            : (lastResponseAt > 0
                                ? `Last response ${formatLastSeen(lastResponseAt, false)}`
                                : 'No responses yet');
                        const statusColor = conversation.session.needsInput ? '#FF3B30' : '#888888';
                        const isLastSessionRow = index === flatList.length - 1;

                        return (
                            <Pressable
                                key={`${conversation.machine.id}:${conversation.session.appTarget}:${conversation.session.id}:${conversation.session.jsonPath}`}
                                style={[
                                    styles.copilotRow,
                                    !isLastSessionRow && styles.copilotRowBorder
                                ]}
                                onPress={() => { void onOpenFlatConversation(conversation); }}
                            >
                                <View style={styles.copilotIconContainer}>
                                    <Ionicons
                                        name={conversation.session.needsInput ? 'alert-circle' : (conversation.session.workspaceOpen ? 'logo-github' : 'folder-open-outline')}
                                        size={18}
                                        color={conversation.session.needsInput ? '#FF3B30' : '#4A5568'}
                                    />
                                </View>
                                <View style={styles.copilotContent}>
                                    <View style={styles.copilotTitleRow}>
                                        <Text style={styles.copilotTitle} numberOfLines={1}>
                                            {conversation.session.title}
                                        </Text>
                                        <View
                                            style={[
                                                styles.copilotMetaBadge,
                                                conversation.session.workspaceOpen ? styles.copilotMetaBadgeOpen : styles.copilotMetaBadgeClosed
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.copilotMetaBadgeText,
                                                    conversation.session.workspaceOpen && styles.copilotMetaBadgeTextOpen
                                                ]}
                                            >
                                                {conversation.session.workspaceOpen ? 'Open' : 'Closed'}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={styles.copilotSubtitle} numberOfLines={1}>
                                        {`${machineName} • ${workspaceLabel}`}
                                    </Text>
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
                </View>
            )}

            {sessionViewMode === 'flat' && showRecent && recentList.length > 0 && (
                <View style={styles.copilotCard}>
                    {recentList.map((workspace, index) => {
                        const machineName = workspace.machine.metadata?.displayName
                            || workspace.machine.metadata?.host
                            || workspace.machine.id;
                        const isLast = index === recentList.length - 1;
                        return (
                            <Pressable
                                key={`${workspace.machine.id}:${workspace.workspace.appTarget}:${workspace.workspace.kind}:${workspace.workspace.path}`}
                                style={[
                                    styles.copilotRow,
                                    !isLast && styles.copilotRowBorder
                                ]}
                                onPress={() => { void onOpenRecentWorkspace(workspace); }}
                            >
                                <View style={styles.copilotIconContainer}>
                                    <Ionicons
                                        name="folder-open-outline"
                                        size={18}
                                        color="#4A5568"
                                    />
                                </View>
                                <View style={styles.copilotContent}>
                                    <View style={styles.copilotTitleRow}>
                                        <Text style={styles.copilotTitle} numberOfLines={1}>
                                            {workspace.workspace.label}
                                        </Text>
                                        <View
                                            style={[
                                                styles.copilotMetaBadge,
                                                workspace.workspace.workspaceOpen ? styles.copilotMetaBadgeOpen : styles.copilotMetaBadgeClosed
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.copilotMetaBadgeText,
                                                    workspace.workspace.workspaceOpen && styles.copilotMetaBadgeTextOpen
                                                ]}
                                            >
                                                {workspace.workspace.workspaceOpen ? 'Open' : 'Closed'}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={styles.copilotSubtitle} numberOfLines={1}>
                                        {`${machineName} • ${workspace.workspace.appName} • ${workspace.workspace.path}`}
                                    </Text>
                                    <View style={styles.copilotStatusRow}>
                                        <Text style={[styles.copilotStatusText, { color: '#888888' }]} numberOfLines={1}>
                                            {workspace.workspace.workspaceOpen ? 'Already open' : 'Tap to open'}
                                        </Text>
                                    </View>
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            )}

            {sessionViewMode === 'flat' && flatList.length === 0 && (
                <View style={styles.copilotCard}>
                    <View style={styles.copilotEmptySearchRow}>
                        <Text style={styles.copilotEmptySearchText}>
                            {trimmedTopSearch.length > 0 ? 'No matching sessions' : 'No sessions available'}
                        </Text>
                    </View>
                </View>
            )}

            {sessionViewMode === 'flat' && showRecent && recentList.length === 0 && (
                <View style={styles.copilotCard}>
                    <View style={styles.copilotEmptySearchRow}>
                        <Text style={styles.copilotEmptySearchText}>
                            {trimmedTopSearch.length > 0 ? 'No matching recent workspaces' : 'No recent workspaces available'}
                        </Text>
                    </View>
                </View>
            )}
        </View>
    );
});
