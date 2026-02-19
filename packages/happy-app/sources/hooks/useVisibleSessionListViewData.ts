import * as React from 'react';
import {
    SessionListViewItem,
    CopilotConversationListItem,
    CopilotFlatConversationListItem,
    CopilotRecentWorkspaceListItem,
    useSessionListViewData,
    useSetting,
    useSocketStatus
} from '@/sync/storage';

function isLiveCopilotConversation(conversation: CopilotConversationListItem): boolean {
    return isLiveCopilotMachine(conversation.machine);
}

function isLiveCopilotFlatConversation(conversation: CopilotFlatConversationListItem): boolean {
    return isLiveCopilotMachine(conversation.machine);
}

function isLiveCopilotRecentWorkspace(workspace: CopilotRecentWorkspaceListItem): boolean {
    return isLiveCopilotMachine(workspace.machine);
}

function isLiveCopilotMachine(machine: CopilotConversationListItem['machine']): boolean {
    if (!machine.active) {
        return false;
    }

    const metadata = machine.metadata as { daemonLastKnownStatus?: 'running' | 'shutting-down' } | null;
    if (metadata?.daemonLastKnownStatus === 'shutting-down') {
        return false;
    }

    return true;
}

export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const hideInactiveSessions = useSetting('hideInactiveSessions');
    const socketStatus = useSocketStatus();

    return React.useMemo(() => {
        if (!data) {
            return data;
        }

        const includeCopilot = socketStatus.status === 'connected';
        const liveData: SessionListViewItem[] = [];

        for (const item of data) {
            if (item.type !== 'copilot-sessions') {
                liveData.push(item);
                continue;
            }

            if (!includeCopilot) {
                continue;
            }

            const liveConversations = item.conversations.filter(isLiveCopilotConversation);
            const liveFlatConversations = item.flatConversations.filter(isLiveCopilotFlatConversation);
            const liveRecentWorkspaces = item.recentWorkspaces.filter(isLiveCopilotRecentWorkspace);
            if (liveConversations.length > 0 || liveFlatConversations.length > 0 || liveRecentWorkspaces.length > 0) {
                liveData.push({
                    ...item,
                    conversations: liveConversations,
                    flatConversations: liveFlatConversations,
                    recentWorkspaces: liveRecentWorkspaces,
                });
            }
        }

        if (!hideInactiveSessions) {
            return liveData;
        }

        const filtered: SessionListViewItem[] = [];
        let pendingProjectGroup: SessionListViewItem | null = null;

        for (const item of liveData) {
            if (item.type === 'project-group') {
                pendingProjectGroup = item;
                continue;
            }

            if (item.type === 'session') {
                if (item.session.active) {
                    if (pendingProjectGroup) {
                        filtered.push(pendingProjectGroup);
                        pendingProjectGroup = null;
                    }
                    filtered.push(item);
                }
                continue;
            }

            pendingProjectGroup = null;

            if (item.type === 'active-sessions') {
                filtered.push(item);
                continue;
            }

            if (item.type === 'copilot-sessions') {
                filtered.push(item);
            }
        }

        return filtered;
    }, [data, hideInactiveSessions, socketStatus.status]);
}
