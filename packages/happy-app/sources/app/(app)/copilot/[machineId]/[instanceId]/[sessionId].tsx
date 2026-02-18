import React from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, Platform, ViewToken, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import Constants from 'expo-constants';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';

import { Typography } from '@/constants/Typography';
import { useHeaderHeight } from '@/utils/responsive';
import { useMachine } from '@/sync/storage';
import {
    machineGetVscodeSessionHistory,
    machineOpenVscodeSession,
    machineSendVscodeMessage,
    type VscodeConversationHistory,
    type VscodeConversationMessage
} from '@/sync/ops';
import { Modal } from '@/modal';
import { MultiTextInput } from '@/components/MultiTextInput';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 24,
    },
    messageRow: {
        marginBottom: 10,
        flexDirection: 'row',
    },
    messageRowUser: {
        justifyContent: 'flex-end',
    },
    messageRowAssistant: {
        justifyContent: 'flex-start',
    },
    bubble: {
        maxWidth: '88%',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 8,
    },
    bubbleUser: {
        backgroundColor: theme.colors.button.primary.background,
    },
    bubbleAssistant: {
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    messageTextUser: {
        color: theme.colors.button.primary.tint,
        fontSize: 15,
        lineHeight: 22,
        ...Typography.default(),
    },
    timestamp: {
        marginTop: 6,
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    timestampUser: {
        textAlign: 'right',
        color: 'rgba(255,255,255,0.78)',
    },
    emptyState: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    emptyTitle: {
        fontSize: 16,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    emptySubtitle: {
        marginTop: 6,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    composerWrapper: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingTop: 8,
    },
    requestNavigatorContainer: {
        marginHorizontal: 12,
        marginBottom: 6,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    requestNavigatorHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    requestNavigatorTitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    requestNavigatorMeta: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    latestIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    latestIndicatorDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        marginRight: 6,
    },
    latestIndicatorText: {
        fontSize: 12,
        ...Typography.default(),
    },
    waitingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    waitingIndicatorText: {
        marginLeft: 6,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    requestPreviewText: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text,
        ...Typography.default(),
    },
    requestNavigatorControls: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    requestControlButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceHighest,
        alignItems: 'center',
        justifyContent: 'center',
    },
    requestControlButtonDisabled: {
        opacity: 0.5,
    },
    requestControlLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    composerRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    inputShell: {
        flex: 1,
        backgroundColor: theme.colors.input.background,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 10,
        paddingVertical: Platform.select({ ios: 8, default: 6 }),
        minHeight: 44,
        marginRight: 8,
    },
    sendButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonInactive: {
        backgroundColor: theme.colors.surfaceHighest,
    },
}));

function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function normalizeMessages(
    messages: unknown,
    sessionId: string
): VscodeConversationMessage[] {
    if (!Array.isArray(messages)) {
        return [];
    }

    return messages
        .map((message, index): VscodeConversationMessage | null => {
            const value = message as Partial<VscodeConversationMessage> | null | undefined;
            if (!value || typeof value !== 'object') {
                return null;
            }

            const role = value.role === 'assistant' ? 'assistant' : 'user';
            const text = typeof value.text === 'string' ? value.text : '';
            const timestamp = typeof value.timestamp === 'number' ? value.timestamp : index;
            const id = typeof value.id === 'string' && value.id.length > 0
                ? value.id
                : `${sessionId}:fallback:${role}:${index}`;

            return { id, role, text, timestamp };
        })
        .filter((message): message is VscodeConversationMessage => message !== null);
}

function sanitizeAssistantMarkdown(markdown: string): string {
    if (!markdown || markdown.trim().length === 0) {
        return '';
    }
    return markdown
        .replace(/```thinking[\s\S]*?```/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
}

type PendingUserMessage = {
    id: string;
    text: string;
    timestamp: number;
};

function isPendingInHistory(
    historyMessages: VscodeConversationMessage[],
    pending: PendingUserMessage
): boolean {
    return historyMessages.some((message) =>
        message.role === 'user'
        && message.text.trim() === pending.text.trim()
        && Math.abs(message.timestamp - pending.timestamp) < 30000
    );
}

export default function CopilotConversationScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const { machineId, instanceId, sessionId } = useLocalSearchParams<{
        machineId: string;
        instanceId: string;
        sessionId: string;
    }>();
    const resolvedMachineId = machineId ? decodeURIComponent(machineId) : '';
    const resolvedInstanceId = instanceId ? decodeURIComponent(instanceId) : '';
    const resolvedSessionId = sessionId ? decodeURIComponent(sessionId) : '';
    const machine = useMachine(resolvedMachineId);

    const [history, setHistory] = React.useState<VscodeConversationHistory | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [isSending, setIsSending] = React.useState(false);
    const [isOpeningVscode, setIsOpeningVscode] = React.useState(false);
    const [awaitingResponseSince, setAwaitingResponseSince] = React.useState<number | null>(null);
    const [inputText, setInputText] = React.useState('');
    const [isReadingLatestResponse, setIsReadingLatestResponse] = React.useState(false);
    const [hasUnreadLatestResponse, setHasUnreadLatestResponse] = React.useState(false);
    const [lastSeenAssistantId, setLastSeenAssistantId] = React.useState<string | null>(null);
    const [previousRequestCursor, setPreviousRequestCursor] = React.useState(0);
    const [pendingUserMessages, setPendingUserMessages] = React.useState<PendingUserMessage[]>([]);
    const listRef = React.useRef<FlatList<VscodeConversationMessage>>(null);
    const didInitialScrollRef = React.useRef(false);
    const pendingScrollTargetRef = React.useRef<{ index: number; viewPosition?: number } | null>(null);
    const latestAssistantIdRef = React.useRef<string | null>(null);

    const loadHistory = React.useCallback(async (options?: { silent?: boolean; suppressErrors?: boolean }) => {
        if (!resolvedMachineId || !resolvedInstanceId || !resolvedSessionId) return;

        if (!options?.silent) {
            setIsLoading(true);
        }

        try {
            const result = await machineGetVscodeSessionHistory(resolvedMachineId, resolvedInstanceId, resolvedSessionId, 250);
            const normalized = {
                ...result,
                messages: normalizeMessages(result?.messages, resolvedSessionId),
            };
            setHistory(normalized);
            setPendingUserMessages((previous) =>
                previous.filter((pending) => !isPendingInHistory(normalized.messages, pending))
            );
            return normalized;
        } catch (error) {
            if (!options?.suppressErrors) {
                Modal.alert(
                    t('common.error'),
                    error instanceof Error ? error.message : 'Failed to load Copilot conversation history.'
                );
            }
        } finally {
            setIsLoading(false);
        }
    }, [resolvedMachineId, resolvedInstanceId, resolvedSessionId]);

    const hasAssistantResponseAfter = React.useCallback((conversation: VscodeConversationHistory | null | undefined, timestamp: number) => {
        if (!conversation?.messages?.length) {
            return false;
        }
        return conversation.messages.some((message) => message.role === 'assistant' && message.timestamp >= timestamp);
    }, []);

    React.useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const historyMessages = React.useMemo(
        () => normalizeMessages(history?.messages, resolvedSessionId),
        [history?.messages, resolvedSessionId]
    );
    const messages = React.useMemo(() => {
        if (pendingUserMessages.length === 0) {
            return historyMessages;
        }

        const unsynced = pendingUserMessages
            .filter((pending) => !isPendingInHistory(historyMessages, pending))
            .map((pending): VscodeConversationMessage => ({
                id: pending.id,
                role: 'user',
                text: pending.text,
                timestamp: pending.timestamp,
            }));

        return [...historyMessages, ...unsynced].sort((a, b) => a.timestamp - b.timestamp);
    }, [historyMessages, pendingUserMessages]);
    const messageCount = messages.length;
    const latestAssistantIndex = React.useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                return i;
            }
        }
        return -1;
    }, [messages]);
    const latestAssistantMessage = latestAssistantIndex >= 0 ? messages[latestAssistantIndex] : null;
    const previousUserIndexesForLatest = React.useMemo(() => {
        if (latestAssistantIndex <= 0) return [] as number[];
        const indexes: number[] = [];
        for (let i = latestAssistantIndex - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                indexes.push(i);
            }
        }
        return indexes.reverse();
    }, [messages, latestAssistantIndex]);
    const currentPreviousRequestCursor = React.useMemo(() => {
        if (previousUserIndexesForLatest.length === 0) return 0;
        return Math.min(previousRequestCursor, previousUserIndexesForLatest.length - 1);
    }, [previousRequestCursor, previousUserIndexesForLatest.length]);
    const previousUserIndexForLatest = previousUserIndexesForLatest[currentPreviousRequestCursor] ?? -1;
    const previousUserMessageForLatest = previousUserIndexForLatest >= 0 ? messages[previousUserIndexForLatest] : null;

    latestAssistantIdRef.current = latestAssistantMessage?.id ?? null;

    const scrollToIndexSafe = React.useCallback((index: number, options?: { animated?: boolean; viewPosition?: number }) => {
        if (index < 0) return;
        pendingScrollTargetRef.current = { index, viewPosition: options?.viewPosition };
        try {
            listRef.current?.scrollToIndex({
                index,
                animated: options?.animated ?? true,
                viewPosition: options?.viewPosition ?? 0,
            });
        } catch {
            // onScrollToIndexFailed will retry once layout catches up
        }
    }, []);

    const scrollToLatestAssistant = React.useCallback((animated: boolean) => {
        if (latestAssistantIndex >= 0) {
            scrollToIndexSafe(latestAssistantIndex, { animated, viewPosition: 0 });
            return;
        }
        listRef.current?.scrollToEnd({ animated });
    }, [latestAssistantIndex, scrollToIndexSafe]);

    React.useEffect(() => {
        didInitialScrollRef.current = false;
        setIsReadingLatestResponse(false);
        setHasUnreadLatestResponse(false);
        setLastSeenAssistantId(null);
        setPreviousRequestCursor(0);
    }, [resolvedMachineId, resolvedInstanceId, resolvedSessionId]);

    React.useEffect(() => {
        if (messageCount === 0 || didInitialScrollRef.current) {
            return;
        }
        didInitialScrollRef.current = true;
        const timeout = setTimeout(() => {
            scrollToLatestAssistant(false);
        }, 60);
        return () => clearTimeout(timeout);
    }, [messageCount, scrollToLatestAssistant]);

    React.useEffect(() => {
        // Reset context pane target for every new assistant reply.
        setPreviousRequestCursor(Math.max(0, previousUserIndexesForLatest.length - 1));
    }, [latestAssistantMessage?.id, previousUserIndexesForLatest.length]);

    React.useEffect(() => {
        const latestId = latestAssistantMessage?.id ?? null;
        if (!latestId) {
            setHasUnreadLatestResponse(false);
            return;
        }

        if (!lastSeenAssistantId) {
            setLastSeenAssistantId(latestId);
            setHasUnreadLatestResponse(false);
            return;
        }

        if (latestId === lastSeenAssistantId) {
            return;
        }

        if (isReadingLatestResponse) {
            setLastSeenAssistantId(latestId);
            setHasUnreadLatestResponse(false);
        } else {
            setHasUnreadLatestResponse(true);
        }
    }, [latestAssistantMessage?.id, lastSeenAssistantId, isReadingLatestResponse]);

    React.useEffect(() => {
        const latestId = latestAssistantMessage?.id ?? null;
        if (!latestId) {
            setHasUnreadLatestResponse(false);
            return;
        }
        if (isReadingLatestResponse) {
            setLastSeenAssistantId(latestId);
            setHasUnreadLatestResponse(false);
        }
    }, [isReadingLatestResponse, latestAssistantMessage?.id]);

    const onScrollToIndexFailed = React.useCallback((info: { index: number; averageItemLength: number }) => {
        const target = pendingScrollTargetRef.current;
        const fallbackIndex = target?.index ?? info.index;
        const fallbackOffset = Math.max(0, info.averageItemLength * fallbackIndex - 24);
        listRef.current?.scrollToOffset({ offset: fallbackOffset, animated: false });
        setTimeout(() => {
            const retryTarget = pendingScrollTargetRef.current;
            const retryIndex = retryTarget?.index ?? info.index;
            const retryViewPosition = retryTarget?.viewPosition ?? 0;
            listRef.current?.scrollToIndex({
                index: retryIndex,
                animated: false,
                viewPosition: retryViewPosition,
            });
        }, 50);
    }, []);

    const onViewableItemsChanged = React.useRef(({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
        const latestId = latestAssistantIdRef.current;
        if (!latestId) {
            setIsReadingLatestResponse(false);
            return;
        }
        const visible = viewableItems.some((token) => {
            const item = token.item as VscodeConversationMessage | undefined;
            return item?.id === latestId;
        });
        setIsReadingLatestResponse((prev) => (prev === visible ? prev : visible));
    }).current;
    const viewabilityConfigRef = React.useRef({
        itemVisiblePercentThreshold: 30,
    });

    const handleRefresh = React.useCallback(async () => {
        setIsRefreshing(true);
        await loadHistory({ silent: true });
        setIsRefreshing(false);
    }, [loadHistory]);

    const handleJumpToLatestResponse = React.useCallback(() => {
        scrollToLatestAssistant(true);
        if (latestAssistantMessage?.id) {
            setLastSeenAssistantId(latestAssistantMessage.id);
        }
        setHasUnreadLatestResponse(false);
        setPreviousRequestCursor(Math.max(0, previousUserIndexesForLatest.length - 1));
    }, [latestAssistantMessage?.id, scrollToLatestAssistant, previousUserIndexesForLatest.length]);

    const navigateToRequestCursor = React.useCallback((nextCursor: number) => {
        if (previousUserIndexesForLatest.length === 0) {
            return;
        }

        const boundedCursor = Math.max(0, Math.min(nextCursor, previousUserIndexesForLatest.length - 1));
        const targetIndex = previousUserIndexesForLatest[boundedCursor];
        scrollToIndexSafe(targetIndex, { animated: true, viewPosition: 0 });
        setPreviousRequestCursor(boundedCursor);
    }, [previousUserIndexesForLatest, scrollToIndexSafe]);

    const handleFirstRequestPress = React.useCallback(() => {
        navigateToRequestCursor(0);
    }, [navigateToRequestCursor]);

    const handlePreviousRequestPress = React.useCallback(() => {
        navigateToRequestCursor(currentPreviousRequestCursor - 1);
    }, [navigateToRequestCursor, currentPreviousRequestCursor]);

    const handleNextRequestPress = React.useCallback(() => {
        navigateToRequestCursor(currentPreviousRequestCursor + 1);
    }, [navigateToRequestCursor, currentPreviousRequestCursor]);

    const handleLastRequestPress = React.useCallback(() => {
        navigateToRequestCursor(previousUserIndexesForLatest.length - 1);
    }, [navigateToRequestCursor, previousUserIndexesForLatest.length]);

    const handleSend = React.useCallback(async () => {
        if (!resolvedMachineId || !resolvedInstanceId || !resolvedSessionId) return;
        const message = inputText.trim();
        if (!message) return;
        const sentAt = Date.now();

        const optimisticMessage: VscodeConversationMessage = {
            id: `local-${sentAt}`,
            role: 'user',
            text: message,
            timestamp: sentAt,
        };
        setPendingUserMessages((previous) => [...previous, optimisticMessage]);
        setInputText('');
        setIsSending(true);

        try {
            const result = await machineSendVscodeMessage(resolvedMachineId, resolvedInstanceId, resolvedSessionId, message);
            if (!result.queued) {
                throw new Error(t('machine.vscodeSendFailed'));
            }
            setAwaitingResponseSince(sentAt);
            const latest = await loadHistory({ silent: true, suppressErrors: true });
            if (hasAssistantResponseAfter(latest, sentAt)) {
                setAwaitingResponseSince(null);
            }
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t('machine.vscodeSendFailed')
            );
            setInputText(message);
            setPendingUserMessages((previous) => previous.filter((pending) => pending.id !== optimisticMessage.id));
            setAwaitingResponseSince(null);
        } finally {
            setIsSending(false);
        }
    }, [resolvedMachineId, resolvedInstanceId, resolvedSessionId, inputText, loadHistory, hasAssistantResponseAfter]);

    const handleOpenInVscode = React.useCallback(async () => {
        if (!resolvedMachineId) {
            return;
        }

        setIsOpeningVscode(true);
        try {
            const snapshotSessions = (((machine?.daemonState as any)?.vscode?.sessions ?? []) as Array<{
                instanceId?: string;
                id?: string;
                workspaceDir?: string;
            }>);
            const snapshotInstances = (((machine?.daemonState as any)?.vscode?.instances ?? []) as Array<{
                instanceId?: string;
                appName?: string;
            }>);
            const matchingSession = snapshotSessions.find((session) =>
                session.instanceId === resolvedInstanceId && session.id === resolvedSessionId
            );
            const matchingInstance = snapshotInstances.find((instance) =>
                instance.instanceId === resolvedInstanceId
            );
            const workspaceDir = history?.session?.workspaceDir ?? matchingSession?.workspaceDir;
            const appTarget = matchingInstance?.appName?.toLowerCase().includes('insider') ? 'insiders' : 'vscode';

            const result = await machineOpenVscodeSession(resolvedMachineId, {
                instanceId: resolvedInstanceId,
                sessionId: resolvedSessionId,
                workspaceDir,
                newWindow: false,
                appTarget,
            });

            if (!result.ok) {
                throw new Error('Failed to open VS Code.');
            }
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : 'Failed to open VS Code.'
            );
        } finally {
            setIsOpeningVscode(false);
        }
    }, [resolvedMachineId, resolvedInstanceId, resolvedSessionId, machine?.daemonState, history?.session?.workspaceDir]);

    React.useEffect(() => {
        if (!awaitingResponseSince) {
            return;
        }

        let cancelled = false;
        const timeoutAt = awaitingResponseSince + 2 * 60 * 1000;

        const poll = async () => {
            if (cancelled) {
                return;
            }

            const latest = await loadHistory({ silent: true, suppressErrors: true });
            if (cancelled || !latest) {
                return;
            }

            if (hasAssistantResponseAfter(latest, awaitingResponseSince) || Date.now() >= timeoutAt) {
                setAwaitingResponseSince(null);
            }
        };

        const interval = setInterval(poll, 2000);
        void poll();

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [awaitingResponseSince, loadHistory, hasAssistantResponseAfter]);

    React.useEffect(() => {
        const cutoff = Date.now() - 5 * 60 * 1000;
        setPendingUserMessages((previous) => previous.filter((pending) => pending.timestamp >= cutoff));
    }, [messageCount]);

    const title = history?.session?.title || 'Copilot';
    const machineName = machine?.metadata?.displayName || machine?.metadata?.host || resolvedMachineId || '';
    const previousRequestPreview = previousUserMessageForLatest?.text?.replace(/\s+/g, ' ').trim() ?? '';
    const latestIndicatorText = isReadingLatestResponse ? 'Viewing latest response' : 'Viewing history';
    const latestIndicatorColor = hasUnreadLatestResponse
        ? theme.colors.button.primary.background
        : (isReadingLatestResponse ? theme.colors.success : theme.colors.textSecondary);
    const isWaitingForResponse = awaitingResponseSince !== null;
    const previousRequestMetaText = previousUserIndexesForLatest.length > 0
        ? `${Math.min(currentPreviousRequestCursor + 1, previousUserIndexesForLatest.length)} of ${previousUserIndexesForLatest.length}`
        : '';
    const canGoBackward = currentPreviousRequestCursor > 0;
    const canGoForward = currentPreviousRequestCursor < previousUserIndexesForLatest.length - 1;

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: title,
                    headerBackTitle: 'Back',
                    headerRight: () => (
                        <Pressable
                            onPress={() => {
                                void handleOpenInVscode();
                            }}
                            disabled={isOpeningVscode}
                            hitSlop={10}
                        >
                            <Ionicons
                                name="open-outline"
                                size={20}
                                color={isOpeningVscode ? theme.colors.textSecondary : theme.colors.text}
                            />
                        </Pressable>
                    ),
                }}
            />
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? Constants.statusBarHeight + headerHeight : 0}
            >
                <FlatList
                    ref={listRef}
                    data={messages}
                    keyExtractor={(item) => item.id}
                    onScrollToIndexFailed={onScrollToIndexFailed}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfigRef.current}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
                    }
                    ListEmptyComponent={isLoading ? null : (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyTitle}>No messages yet</Text>
                            <Text style={styles.emptySubtitle}>{machineName ? `${machineName} • Pull to refresh` : 'Pull to refresh'}</Text>
                        </View>
                    )}
                    renderItem={({ item }) => {
                        const isUser = item.role === 'user';
                        return (
                            <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
                                <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
                                    {isUser ? (
                                        <Text style={styles.messageTextUser}>{item.text}</Text>
                                    ) : (
                                        <MarkdownView markdown={sanitizeAssistantMarkdown(item.text)} />
                                    )}
                                    <Text style={[styles.timestamp, isUser && styles.timestampUser]}>
                                        {formatTimestamp(item.timestamp)}
                                    </Text>
                                </View>
                            </View>
                        );
                    }}
                />

                {previousUserMessageForLatest && (
                    <View style={styles.requestNavigatorContainer}>
                        <View style={styles.requestNavigatorHeader}>
                            <View>
                                <Text style={styles.requestNavigatorTitle}>Previous request</Text>
                                {previousRequestMetaText.length > 0 && (
                                    <Text style={styles.requestNavigatorMeta}>{previousRequestMetaText}</Text>
                                )}
                            </View>
                            <Pressable
                                style={styles.latestIndicator}
                                disabled={!hasUnreadLatestResponse}
                                onPress={handleJumpToLatestResponse}
                            >
                                {isWaitingForResponse ? (
                                    <View style={styles.waitingIndicator}>
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                        <Text style={styles.waitingIndicatorText}>Waiting for response</Text>
                                    </View>
                                ) : (
                                    <>
                                        <View style={[styles.latestIndicatorDot, { backgroundColor: latestIndicatorColor }]} />
                                        <Text style={[styles.latestIndicatorText, { color: latestIndicatorColor }]}>
                                            {hasUnreadLatestResponse ? 'New response available' : latestIndicatorText}
                                        </Text>
                                    </>
                                )}
                            </Pressable>
                        </View>
                        <Pressable onPress={() => navigateToRequestCursor(currentPreviousRequestCursor)}>
                            <Text style={styles.requestPreviewText} numberOfLines={2}>
                                {previousRequestPreview}
                            </Text>
                        </Pressable>
                        <View style={styles.requestNavigatorControls}>
                            <Pressable
                                style={[styles.requestControlButton, !canGoBackward && styles.requestControlButtonDisabled]}
                                onPress={handleFirstRequestPress}
                                disabled={!canGoBackward}
                                hitSlop={10}
                            >
                                <Ionicons name="play-skip-back" size={14} color={theme.colors.text} />
                            </Pressable>
                            <Pressable
                                style={[styles.requestControlButton, !canGoBackward && styles.requestControlButtonDisabled]}
                                onPress={handlePreviousRequestPress}
                                disabled={!canGoBackward}
                                hitSlop={10}
                            >
                                <Ionicons name="chevron-back" size={16} color={theme.colors.text} />
                            </Pressable>
                            <Text style={styles.requestControlLabel}>
                                {previousRequestMetaText}
                            </Text>
                            <Pressable
                                style={[styles.requestControlButton, !canGoForward && styles.requestControlButtonDisabled]}
                                onPress={handleNextRequestPress}
                                disabled={!canGoForward}
                                hitSlop={10}
                            >
                                <Ionicons name="chevron-forward" size={16} color={theme.colors.text} />
                            </Pressable>
                            <Pressable
                                style={[styles.requestControlButton, !canGoForward && styles.requestControlButtonDisabled]}
                                onPress={handleLastRequestPress}
                                disabled={!canGoForward}
                                hitSlop={10}
                            >
                                <Ionicons name="play-skip-forward" size={14} color={theme.colors.text} />
                            </Pressable>
                        </View>
                    </View>
                )}

                <View style={[styles.composerWrapper, { paddingBottom: Math.max(8, safeArea.bottom) }]}>
                    <View style={styles.composerRow}>
                        <View style={styles.inputShell}>
                            <MultiTextInput
                                value={inputText}
                                onChangeText={setInputText}
                                placeholder={t('machine.vscodeMessagePlaceholder')}
                                maxHeight={120}
                            />
                        </View>
                        <Pressable
                            style={[styles.sendButton, inputText.trim().length > 0 && !isSending ? styles.sendButtonActive : styles.sendButtonInactive]}
                            onPress={handleSend}
                            disabled={isSending || inputText.trim().length === 0}
                        >
                            <Ionicons
                                name="arrow-up"
                                size={18}
                                color={inputText.trim().length > 0 && !isSending ? theme.colors.button.primary.tint : theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </>
    );
}
