import React from 'react';
import { View, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import type { CopilotConversationListItem, CopilotFlatConversationListItem, SessionListViewItem } from '@/sync/storage';
import { useMachine } from '@/sync/storage';
import { machineOpenVscodeSession, type VscodeAppTarget } from '@/sync/ops';
import { formatLastSeen } from '@/utils/sessionUtils';
import { StatusDot } from '@/components/StatusDot';
import { Modal } from '@/modal';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    subtitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 10,
        ...Typography.default(),
    },
    card: {
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
    },
    row: {
        minHeight: 84,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
    },
    rowBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        marginRight: 12,
    },
    contentBlock: {
        flex: 1,
    },
    title: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    statusRow: {
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusText: {
        fontSize: 12,
        ...Typography.default(),
    },
    emptyCard: {
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 18,
        backgroundColor: theme.colors.surface,
    },
    emptyText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    headerAction: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

type WorkspaceIdentity = {
    kind: 'folder' | 'workspace-file';
    path: string;
};

type ConversationRow =
    | { kind: 'live'; key: string; conversation: CopilotConversationListItem; title: string; needsInput: boolean; lastResponseAt: number }
    | { kind: 'flat'; key: string; conversation: CopilotFlatConversationListItem; title: string; needsInput: boolean; lastResponseAt: number };

function getStringParam(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

function getPathTail(pathLike: string | null | undefined): string {
    if (!pathLike) {
        return '';
    }
    const parts = pathLike.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? pathLike;
}

function normalizeWorkspacePath(pathLike: string): string {
    return pathLike.replace(/\\/g, '/').toLowerCase();
}

function buildWorkspacePathKey(machineId: string, appTarget: 'vscode' | 'insiders', identity: WorkspaceIdentity): string {
    return `${machineId}:${appTarget}:${identity.kind}:${normalizeWorkspacePath(identity.path)}`;
}

function getConversationAppTarget(conversation: CopilotConversationListItem): 'vscode' | 'insiders' {
    return conversation.instance?.appName?.toLowerCase().includes('insider') ? 'insiders' : 'vscode';
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
    if (conversation.session.workspaceFile) {
        return { kind: 'workspace-file', path: conversation.session.workspaceFile };
    }
    if (conversation.session.workspaceDir) {
        return { kind: 'folder', path: conversation.session.workspaceDir };
    }
    return null;
}

function normalizeAppTarget(value: string | undefined): VscodeAppTarget {
    return value === 'insiders' ? 'insiders' : 'vscode';
}

export default function CopilotWorkspaceConversationsScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const params = useLocalSearchParams<{
        machineId?: string;
        groupKey?: string;
        appTarget?: string;
        instanceLabel?: string;
        instanceId?: string;
        workspaceDir?: string;
        workspaceFile?: string;
    }>();

    const machineId = getStringParam(params.machineId) ?? '';
    const groupKey = getStringParam(params.groupKey) ?? '';
    const appTargetParam = getStringParam(params.appTarget);
    const instanceLabelParam = getStringParam(params.instanceLabel);
    const instanceIdParam = getStringParam(params.instanceId);
    const workspaceDirParam = getStringParam(params.workspaceDir);
    const workspaceFileParam = getStringParam(params.workspaceFile);

    const machine = useMachine(machineId);
    const visibleData = useVisibleSessionListViewData();
    const [isCreating, setIsCreating] = React.useState(false);
    const [openingRowKey, setOpeningRowKey] = React.useState<string | null>(null);

    const copilotItem = React.useMemo(() => {
        if (!visibleData) {
            return null;
        }
        return visibleData.find((item): item is Extract<SessionListViewItem, { type: 'copilot-sessions' }> => item.type === 'copilot-sessions') ?? null;
    }, [visibleData]);

    const liveConversations = React.useMemo(() => {
        if (!copilotItem || !machineId || !groupKey) {
            return [] as CopilotConversationListItem[];
        }
        return copilotItem.conversations.filter((conversation) => {
            if (conversation.machine.id !== machineId) {
                return false;
            }
            const keys = new Set<string>([
                `${machineId}:instance:${conversation.session.instanceId}`
            ]);
            const identity = getWorkspaceIdentityFromConversation(conversation);
            if (identity) {
                keys.add(buildWorkspacePathKey(machineId, getConversationAppTarget(conversation), identity));
            }
            return keys.has(groupKey);
        });
    }, [copilotItem, machineId, groupKey]);

    const groupedFlatConversations = React.useMemo(() => {
        const byKey = new Map<string, CopilotFlatConversationListItem[]>();
        if (!copilotItem || !machineId) {
            return byKey;
        }

        copilotItem.flatConversations.forEach((conversation) => {
            if (conversation.machine.id !== machineId) {
                return;
            }
            const keys = new Set<string>();
            const identity = getWorkspaceIdentityFromFlatConversation(conversation);
            if (identity) {
                keys.add(buildWorkspacePathKey(machineId, conversation.session.appTarget, identity));
            }
            if (conversation.session.instanceId) {
                keys.add(`${machineId}:instance:${conversation.session.instanceId}`);
            }
            keys.forEach((key) => {
                const existing = byKey.get(key) ?? [];
                const dedupeKey = `${conversation.machine.id}:${conversation.session.appTarget}:${conversation.session.id}:${conversation.session.jsonPath}`;
                const alreadyExists = existing.some((item) => {
                    const existingKey = `${item.machine.id}:${item.session.appTarget}:${item.session.id}:${item.session.jsonPath}`;
                    return existingKey === dedupeKey;
                });
                if (!alreadyExists) {
                    existing.push(conversation);
                    byKey.set(key, existing);
                }
            });
        });

        return byKey;
    }, [copilotItem, machineId]);

    const flatConversations = React.useMemo(() => {
        if (!groupKey) {
            return [] as CopilotFlatConversationListItem[];
        }
        return groupedFlatConversations.get(groupKey) ?? [];
    }, [groupKey, groupedFlatConversations]);

    const rows = React.useMemo(() => {
        const liveKeys = new Set<string>();
        liveConversations.forEach((conversation) => {
            liveKeys.add(`${conversation.machine.id}:${conversation.session.id}:${conversation.session.jsonPath}`);
        });
        const fallbackFlat = flatConversations.filter((conversation) => {
            const liveKey = `${conversation.machine.id}:${conversation.session.id}:${conversation.session.jsonPath}`;
            return !liveKeys.has(liveKey);
        });

        const nextRows: ConversationRow[] = [
            ...liveConversations.map((conversation) => ({
                kind: 'live' as const,
                key: `${conversation.machine.id}:${conversation.session.instanceId}:${conversation.session.id}:${conversation.session.jsonPath}`,
                conversation,
                title: conversation.session.title,
                needsInput: conversation.session.needsInput,
                lastResponseAt: conversation.session.lastMessageDate ?? 0,
            })),
            ...fallbackFlat.map((conversation) => ({
                kind: 'flat' as const,
                key: `${conversation.machine.id}:${conversation.session.appTarget}:${conversation.session.id}:${conversation.session.jsonPath}`,
                conversation,
                title: conversation.session.title,
                needsInput: conversation.session.needsInput,
                lastResponseAt: conversation.session.lastMessageDate ?? 0,
            })),
        ];

        nextRows.sort((a, b) => {
            if (a.needsInput !== b.needsInput) {
                return Number(b.needsInput) - Number(a.needsInput);
            }
            return b.lastResponseAt - a.lastResponseAt;
        });

        return nextRows;
    }, [liveConversations, flatConversations]);

    const seedLiveConversation = liveConversations[0] ?? null;
    const seedFlatConversation = flatConversations[0] ?? null;
    const resolvedAppTarget = normalizeAppTarget(
        appTargetParam
            ?? seedFlatConversation?.session.appTarget
            ?? (seedLiveConversation ? getConversationAppTarget(seedLiveConversation) : 'vscode')
    );
    const resolvedInstanceId = instanceIdParam
        ?? seedLiveConversation?.session.instanceId
        ?? seedFlatConversation?.session.instanceId;
    const resolvedWorkspaceFile = workspaceFileParam
        ?? seedLiveConversation?.session.workspaceFile
        ?? seedFlatConversation?.session.workspaceFile;
    const resolvedWorkspaceDir = workspaceDirParam
        ?? seedLiveConversation?.session.workspaceDir
        ?? seedFlatConversation?.session.workspaceDir;

    const title = instanceLabelParam
        ?? (getPathTail(resolvedWorkspaceFile || resolvedWorkspaceDir) || 'Conversations');
    const machineName = machine?.metadata?.displayName || machine?.metadata?.host || machineId;

    const handleCreateConversation = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        setIsCreating(true);
        try {
            const result = await machineOpenVscodeSession(machineId, {
                instanceId: resolvedInstanceId,
                workspaceDir: resolvedWorkspaceDir,
                workspaceFile: resolvedWorkspaceFile,
                newWindow: false,
                appTarget: resolvedAppTarget,
            });
            if (!result.ok) {
                throw new Error('Failed to create a new Copilot conversation.');
            }
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : 'Failed to create a new Copilot conversation.'
            );
        } finally {
            setIsCreating(false);
        }
    }, [machineId, resolvedInstanceId, resolvedWorkspaceDir, resolvedWorkspaceFile, resolvedAppTarget]);

    const handleOpenFlatConversation = React.useCallback(async (conversation: CopilotFlatConversationListItem) => {
        if (conversation.session.workspaceOpen && conversation.session.instanceId) {
            router.push(
                `/copilot/${encodeURIComponent(conversation.machine.id)}/${encodeURIComponent(conversation.session.instanceId)}/${encodeURIComponent(conversation.session.id)}` as any
            );
            return;
        }

        setOpeningRowKey(conversation.session.id);
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
        } finally {
            setOpeningRowKey(null);
        }
    }, [router]);

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: title,
                    headerBackTitle: 'Back',
                    headerRight: () => (
                        <Pressable
                            style={styles.headerAction}
                            onPress={() => { void handleCreateConversation(); }}
                            disabled={isCreating}
                            hitSlop={10}
                        >
                            {isCreating ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : (
                                <Ionicons name="add" size={20} color={theme.colors.text} />
                            )}
                        </Pressable>
                    ),
                }}
            />
            <View style={styles.container}>
                <FlatList
                    data={rows}
                    keyExtractor={(item) => item.key}
                    contentContainerStyle={styles.content}
                    ListHeaderComponent={
                        <Text style={styles.subtitle}>
                            {machineName ? `${machineName} • ${rows.length} conversation${rows.length === 1 ? '' : 's'}` : `${rows.length} conversation${rows.length === 1 ? '' : 's'}`}
                        </Text>
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyText}>No conversations available for this workspace.</Text>
                        </View>
                    }
                    renderItem={({ item, index }) => {
                        const statusText = item.needsInput
                            ? t('machine.vscodeNeedsInput')
                            : (item.lastResponseAt > 0
                                ? `Last response ${formatLastSeen(item.lastResponseAt, false)}`
                                : 'No responses yet');
                        const statusColor = item.needsInput ? '#FF3B30' : '#888888';
                        const isLast = index === rows.length - 1;
                        const isOpening = item.kind === 'flat' && openingRowKey === item.conversation.session.id;

                        return (
                            <Pressable
                                style={[
                                    styles.row,
                                    !isLast && styles.rowBorder,
                                ]}
                                onPress={() => {
                                    if (item.kind === 'live') {
                                        router.push(
                                            `/copilot/${encodeURIComponent(item.conversation.machine.id)}/${encodeURIComponent(item.conversation.session.instanceId)}/${encodeURIComponent(item.conversation.session.id)}` as any
                                        );
                                        return;
                                    }
                                    void handleOpenFlatConversation(item.conversation);
                                }}
                            >
                                <View style={styles.iconContainer}>
                                    {isOpening ? (
                                        <ActivityIndicator size="small" color="#7C7C7C" />
                                    ) : (
                                        <Ionicons
                                            name={item.needsInput ? 'alert-circle' : 'logo-github'}
                                            size={18}
                                            color={item.needsInput ? '#FF3B30' : '#4A5568'}
                                        />
                                    )}
                                </View>
                                <View style={styles.contentBlock}>
                                    <Text style={styles.title} numberOfLines={1}>
                                        {item.title}
                                    </Text>
                                    <View style={styles.statusRow}>
                                        {item.needsInput && (
                                            <StatusDot color={statusColor} isPulsing />
                                        )}
                                        <Text
                                            style={[
                                                styles.statusText,
                                                { color: statusColor, marginLeft: item.needsInput ? 4 : 0 },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {statusText}
                                        </Text>
                                    </View>
                                </View>
                            </Pressable>
                        );
                    }}
                    ItemSeparatorComponent={() => null}
                    ListFooterComponent={rows.length > 0 ? <View style={{ height: 12 }} /> : null}
                />
            </View>
        </>
    );
}
