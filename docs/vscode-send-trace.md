# VS Code Copilot Send Trace (Command -> Model -> Disk)

This traces why a sent message can be visible in VS Code but not immediately visible in Happy's Copilot view.

## 1) Send command path

1. Happy app sends `vscode-send` RPC with `{ instanceId, sessionId, message }`.
2. Daemon queues command in per-instance command queue.
3. VS Code bridge extension polls commands and handles `sendMessage`.
4. Extension opens the session URI and invokes `workbench.action.chat.submit`.
5. VS Code `ChatSubmitAction` resolves target widget from `context.widget ?? widgetService.lastFocusedWidget` and calls `widget.acceptInput(context.inputValue)`.
6. `acceptInput` calls `chatService.sendRequest(...)`, which mutates `ChatModel` in memory (`addRequest`, response progress, etc.).

### Important targeting caveat

`workbench.action.chat.focusInput` also targets `lastFocusedWidget`, not a provided session resource. If focus has not moved to the intended session widget yet, submit can land in a different chat widget/session.

### Important restore caveat

When opening a local session URI, if the session cannot be restored in that window, VS Code creates a new local session for that URI.

## 2) Persistence path (why files lag)

1. Chat persistence is triggered from `storageService.onWillSaveState(() => saveState())`.
2. Storage flush is scheduled when idle with a default interval of 60 seconds.
3. On save:
   - Local chat sessions are written to `chatSessions/*.jsonl|*.json`.
   - Non-local (contributed) sessions are metadata-only in the chat index.
4. Happy daemon conversation history currently reads from `session.jsonPath` on disk.

Result: the daemon/app can poll frequently and still read stale transcript data until VS Code flushes state.

## 3) Sequence diagram

```mermaid
sequenceDiagram
    participant App as Happy App (Copilot screen)
    participant RPC as API Machine RPC
    participant Bridge as Daemon VscodeBridge
    participant Ext as Happy VS Code Extension
    participant Cmd as VS Code Command Layer
    participant W as ChatWidgetService
    participant CS as ChatService
    participant M as ChatModel (in-memory)
    participant SS as StorageService
    participant Store as ChatSessionStore
    participant Disk as chatSessions/*.jsonl

    App->>RPC: machineSendVscodeMessage(instanceId, sessionId, message)
    RPC->>Bridge: vscode-send
    Bridge->>Bridge: queueSendMessage(instanceId, sessionId, message)

    loop every ~1.5s
      Ext->>Bridge: getCommands(instanceId)
      Bridge-->>Ext: sendMessage(sessionId, message)
    end

    Ext->>Cmd: vscode.open(chatSessionUri(sessionId))
    Note over Cmd: If local session cannot be restored in this window,\nChatEditorInput.resolve starts a new local session.

    Ext->>Cmd: workbench.action.chat.submit({ inputValue: message })
    Cmd->>W: resolve widget via lastFocusedWidget

    alt wrong lastFocusedWidget
      Cmd->>M: acceptInput on different session
    else intended widget focused
      Cmd->>CS: sendRequest(sessionResource, message)
      CS->>M: addRequest / acceptResponseProgress (memory update)
    end

    par app polling history (every ~2s while awaiting response)
      App->>RPC: machineGetVscodeSessionHistory(instanceId, sessionId)
      RPC->>Bridge: vscode-get-session-history
      Bridge->>Disk: read session.jsonPath
      Disk-->>App: stale until flush
    and VS Code persistence (idle/shutdown)
      SS->>CS: onWillSaveState
      CS->>Store: storeSessions(local), metadataOnly(non-local)
      Store->>Disk: append/write .jsonl + update index
    end
```

## 4) Source references

### Happy code
- `packages/happy-app/sources/sync/ops.ts` (`machineSendVscodeMessage`, `machineGetVscodeSessionHistory`)
- `packages/happy-app/sources/app/(app)/copilot/[machineId]/[instanceId]/[sessionId].tsx` (send, optimistic UI, 2s history polling)
- `packages/happy-cli/src/api/apiMachine.ts` (`vscode-send`, `vscode-get-session-history` handlers)
- `packages/happy-cli/src/daemon/run.ts` (RPC wiring to bridge)
- `packages/happy-cli/src/daemon/vscodeBridge.ts` (`queueSendMessage`, `getSessionHistory` reads `jsonPath`)
- `packages/happy-vscode-extension/src/extension.ts` (`sendMessageToChat`, `scanAndSendSessions`, command polling)

### VS Code source
- `.tmp/vscode/src/vs/workbench/contrib/chat/browser/actions/chatExecuteActions.ts` (`workbench.action.chat.submit` targets `lastFocusedWidget`)
- `.tmp/vscode/src/vs/workbench/contrib/chat/browser/actions/chatActions.ts` (`workbench.action.chat.focusInput` targets `lastFocusedWidget`)
- `.tmp/vscode/src/vs/workbench/contrib/chat/browser/widgetHosts/editor/chatEditorInput.ts` (fallback to new local session)
- `.tmp/vscode/src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` (`acceptInput` -> `chatService.sendRequest`)
- `.tmp/vscode/src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts` (in-memory mutation + save hook + local/non-local persistence split)
- `.tmp/vscode/src/vs/platform/storage/common/storage.ts` (idle flush scheduler, 60s default)
- `.tmp/vscode/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts` (writes `.jsonl/.json` and index)
