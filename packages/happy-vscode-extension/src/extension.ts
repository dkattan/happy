import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import {
  DaemonClient,
  resolveBaseUrl,
  resolveDaemonStatePath,
  type VscodeCommand,
  type VscodeConversationMessage
} from './daemonClient';
import { scanVscodeSessions } from './sessionScan';
import { getDefaultDaemonStatePath } from './paths';

const OUTPUT_CHANNEL_NAME = 'Happy VS Code Bridge';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getChatSessionUri(sessionId: string): vscode.Uri {
  if (sessionId.includes('://')) {
    try {
      return vscode.Uri.parse(sessionId);
    } catch {
      // Fall through to local-session URI construction.
    }
  }
  const encoded = base64UrlEncode(sessionId);
  return vscode.Uri.parse(`vscode-chat-session://local/${encoded}`);
}

type ChatRequestRecord = {
  message?: unknown;
  response?: unknown;
  timestamp?: unknown;
};

type ChatSessionExportJson = {
  requests?: unknown;
  creationDate?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function extractUserText(request: ChatRequestRecord): string {
  const message = asRecord(request.message);
  if (!message) return '';

  const direct = asString(message.text);
  if (direct && direct.trim().length > 0) {
    return direct.trim();
  }

  const parts = Array.isArray(message.parts) ? message.parts : [];
  const chunks: string[] = [];
  for (const part of parts) {
    const partRecord = asRecord(part);
    const text = partRecord ? asString(partRecord.text) : undefined;
    if (text && text.trim().length > 0) {
      chunks.push(text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function extractAssistantText(request: ChatRequestRecord): string {
  const response = Array.isArray(request.response) ? request.response : [];
  if (response.length === 0) return '';

  const chunks: string[] = [];
  for (const entry of response) {
    const record = asRecord(entry);
    if (!record) continue;

    const kind = asString(record.kind)?.toLowerCase();
    if (kind === 'thinking' || kind === 'preparetoolinvocation' || kind === 'toolinvocationserialized' || kind === 'inlinereference' || kind === 'mcpserversstarting') {
      continue;
    }

    const text = asString(record.value) ?? asString(record.text) ?? asString(record.content) ?? asString(record.markdown);
    if (!text || text.trim().length === 0) continue;
    chunks.push(text);
  }

  return chunks.join('').trim();
}

function extractMessagesFromExport(sessionId: string, parsed: ChatSessionExportJson, limit: number = 250): VscodeConversationMessage[] {
  const requests = Array.isArray(parsed.requests) ? parsed.requests as ChatRequestRecord[] : [];
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const startIndex = Math.max(0, requests.length - effectiveLimit);
  const baseTimestamp = asNumber(parsed.creationDate) ?? Date.now();

  const messages: VscodeConversationMessage[] = [];
  for (let i = startIndex; i < requests.length; i++) {
    const request = requests[i];
    const timestamp = asNumber(request.timestamp) ?? baseTimestamp + i;

    const userText = extractUserText(request);
    if (userText.length > 0) {
      messages.push({
        id: `${sessionId}:u:${i}`,
        role: 'user',
        text: userText,
        timestamp
      });
    }

    const assistantText = extractAssistantText(request);
    if (assistantText.length > 0) {
      messages.push({
        id: `${sessionId}:a:${i}`,
        role: 'assistant',
        text: assistantText,
        timestamp: timestamp + 1
      });
    }
  }

  return messages;
}

class HappyBridge {
  private instanceId = randomUUID();
  private client: DaemonClient | null = null;
  private timers: NodeJS.Timeout[] = [];
  private scanning = false;
  private polling = false;
  private liveHistorySyncing = false;
  private reconnecting = false;
  private lastReconnectAt = 0;
  private lastSessionHash: string | null = null;
  private liveHistoryMonitorUntil = new Map<string, number>();
  private liveHistoryHashes = new Map<string, string>();
  private lastOpenedChatSessionId: string | null = null;
  private static readonly RECONNECT_COOLDOWN_MS = 5000;
  private static readonly LIVE_HISTORY_MONITOR_MS = 120000;

  constructor(private output: vscode.OutputChannel) {}

  async start(context: vscode.ExtensionContext): Promise<void> {
    await this.refreshClient();

    const configChange = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('happy.vscode')) {
        this.output.appendLine('[bridge] Configuration changed, reloading client.');
        this.refreshClient();
      }
    });
    context.subscriptions.push(configChange);

    this.startTimers();
    this.output.appendLine('[bridge] Ready.');
  }

  dispose(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
  }

  private startTimers(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];

    const config = this.getConfig();
    const scanInterval = Math.max(3000, config.scanIntervalMs);
    const heartbeatInterval = Math.max(5000, config.heartbeatIntervalMs);
    const commandInterval = Math.max(500, config.commandPollIntervalMs);
    const liveHistoryInterval = 2000;

    this.timers.push(setInterval(() => void this.sendHeartbeat(), heartbeatInterval));
    this.timers.push(setInterval(() => void this.scanAndSendSessions(), scanInterval));
    this.timers.push(setInterval(() => void this.pollCommands(), commandInterval));
    this.timers.push(setInterval(() => void this.publishMonitoredLiveHistory(), liveHistoryInterval));

    void this.sendHeartbeat();
    void this.scanAndSendSessions();
    void this.pollCommands();
    void this.publishMonitoredLiveHistory();
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration('happy.vscode');
    const daemonBaseUrl = config.get<string>('daemonBaseUrl') ?? '';
    const daemonHttpPort = config.get<number>('daemonHttpPort') ?? 0;
    const daemonStatePathSetting = config.get<string>('daemonStatePath') ?? '';
    const autoStartDaemon = config.get<boolean>('autoStartDaemon') ?? true;
    const scanIntervalMs = config.get<number>('scanIntervalMs') ?? 15000;
    const heartbeatIntervalMs = config.get<number>('heartbeatIntervalMs') ?? 30000;
    const commandPollIntervalMs = config.get<number>('commandPollIntervalMs') ?? 1500;
    const chatSendTargetRaw = config.get<string>('chatSendTarget') ?? 'editor';
    const chatSendTarget = chatSendTargetRaw === 'panel' ? 'panel' : 'editor';

    const daemonStatePath = resolveDaemonStatePath(
      daemonStatePathSetting,
      getDefaultDaemonStatePath()
    );

    return {
      daemonBaseUrl,
      daemonHttpPort,
      daemonStatePath,
      autoStartDaemon,
      scanIntervalMs,
      heartbeatIntervalMs,
      commandPollIntervalMs,
      chatSendTarget
    };
  }

  private async refreshClient(): Promise<void> {
    const config = this.getConfig();
    let baseUrl = resolveBaseUrl({
      daemonBaseUrl: config.daemonBaseUrl,
      daemonHttpPort: config.daemonHttpPort,
      daemonStatePath: config.daemonStatePath
    });

    if (!baseUrl && config.autoStartDaemon) {
      this.output.appendLine('[bridge] Daemon not detected, attempting to start.');
      await this.tryStartDaemon();
      await delay(1500);
      baseUrl = resolveBaseUrl({
        daemonBaseUrl: config.daemonBaseUrl,
        daemonHttpPort: config.daemonHttpPort,
        daemonStatePath: config.daemonStatePath
      });
    }

    if (!baseUrl) {
      this.output.appendLine('[bridge] Unable to resolve daemon base URL.');
      this.client = null;
      return;
    }

    this.client = new DaemonClient({ baseUrl });
    this.output.appendLine(`[bridge] Using daemon at ${baseUrl}`);

    try {
      await this.registerInstance();
    } catch (error) {
      this.output.appendLine(`[bridge] Failed to register: ${error instanceof Error ? error.message : String(error)}`);
      await this.maybeRecoverConnection('register', error);
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('404');
  }

  private isFetchFailure(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('fetch failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('econnrefused') ||
      msg.includes('network')
    );
  }

  private async maybeRecoverConnection(source: string, error: unknown): Promise<void> {
    if (!this.isFetchFailure(error)) {
      return;
    }

    const now = Date.now();
    if (this.reconnecting || now - this.lastReconnectAt < HappyBridge.RECONNECT_COOLDOWN_MS) {
      return;
    }

    this.reconnecting = true;
    this.lastReconnectAt = now;
    this.output.appendLine(`[bridge] Connection issue during ${source}; reloading daemon endpoint.`);
    try {
      await this.refreshClient();
    } finally {
      this.reconnecting = false;
    }
  }

  private async ensureClient(source: string): Promise<boolean> {
    if (this.client) {
      return true;
    }

    const now = Date.now();
    if (this.reconnecting || now - this.lastReconnectAt < HappyBridge.RECONNECT_COOLDOWN_MS) {
      return false;
    }

    this.reconnecting = true;
    this.lastReconnectAt = now;
    this.output.appendLine(`[bridge] No daemon client during ${source}; attempting reconnect.`);
    try {
      await this.refreshClient();
      return this.client !== null;
    } finally {
      this.reconnecting = false;
    }
  }

  private async tryStartDaemon(): Promise<void> {
    try {
      const child = spawn('happy', ['daemon', 'start'], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      this.output.appendLine('[bridge] Spawned happy daemon start.');
    } catch (error) {
      this.output.appendLine(`[bridge] Failed to spawn daemon: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async registerInstance(): Promise<void> {
    if (!this.client) return;

    const workspaceFolders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const workspaceFile = vscode.workspace.workspaceFile?.fsPath ?? null;

    await this.client.register({
      instanceId: this.instanceId,
      appName: vscode.env.appName,
      appVersion: vscode.version,
      platform: process.platform,
      pid: process.pid,
      workspaceFolders,
      workspaceFile
    });

    this.output.appendLine(`[bridge] Registered VS Code instance ${this.instanceId}.`);
    this.output.appendLine(`[bridge] Workspace context: ${workspaceFile ?? '(folder window)'} | folders=${workspaceFolders.length}`);
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.client) {
      const recovered = await this.ensureClient('heartbeat');
      if (!recovered || !this.client) return;
    }
    try {
      await this.client.heartbeat(this.instanceId);
    } catch (error) {
      this.output.appendLine(`[bridge] Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      if (this.isNotFoundError(error)) {
        await this.registerInstance().catch(() => undefined);
      }
      await this.maybeRecoverConnection('heartbeat', error);
    }
  }

  private async scanAndSendSessions(): Promise<void> {
    if (this.scanning) return;
    if (!this.client) {
      const recovered = await this.ensureClient('session scan');
      if (!recovered || !this.client) return;
    }
    this.scanning = true;
    try {
      const sessions = await scanVscodeSessions({
        workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
        workspaceFile: vscode.workspace.workspaceFile?.fsPath ?? null,
        appName: vscode.env.appName
      });
      const hash = JSON.stringify(sessions);
      if (hash !== this.lastSessionHash) {
        await this.client.updateSessions(this.instanceId, sessions);
        this.lastSessionHash = hash;
        this.output.appendLine(`[bridge] Published ${sessions.length} VS Code chat session(s).`);
      }
    } catch (error) {
      this.output.appendLine(`[bridge] Session scan failed: ${error instanceof Error ? error.message : String(error)}`);
      if (this.isNotFoundError(error)) {
        await this.registerInstance().catch(() => undefined);
      }
      await this.maybeRecoverConnection('session scan', error);
    } finally {
      this.scanning = false;
    }
  }

  private async pollCommands(): Promise<void> {
    if (this.polling) return;
    if (!this.client) {
      const recovered = await this.ensureClient('command poll');
      if (!recovered || !this.client) return;
    }
    this.polling = true;
    try {
      const commands = await this.client.getCommands(this.instanceId);
      if (commands.length > 0) {
        this.output.appendLine(`[bridge] Received ${commands.length} command(s).`);
      }
      for (const command of commands) {
        await this.handleCommand(command);
      }
    } catch (error) {
      this.output.appendLine(`[bridge] Command poll failed: ${error instanceof Error ? error.message : String(error)}`);
      if (this.isNotFoundError(error)) {
        await this.registerInstance().catch(() => undefined);
      }
      await this.maybeRecoverConnection('command poll', error);
    } finally {
      this.polling = false;
    }
  }

  private async handleCommand(command: VscodeCommand): Promise<void> {
    if (!this.client) return;
    let ok = true;
    try {
      this.output.appendLine(`[bridge] Handling command ${command.id} (${command.type}) for session ${command.sessionId}.`);
      if (command.type === 'sendMessage') {
        await this.sendMessageToChat(command.sessionId, command.message);
      } else if (command.type === 'openSession') {
        await this.openSessionInChat(command.sessionId);
      }
      this.output.appendLine(`[bridge] Command ${command.id} completed.`);
    } catch (error) {
      ok = false;
      this.output.appendLine(`[bridge] Command failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await this.client.ackCommand(this.instanceId, command.id, ok);
    }
  }

  private hasChatSessionTab(uri: vscode.Uri): boolean {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) {
          return true;
        }
      }
    }
    return false;
  }

  private async ensureChatSessionOpen(sessionId: string): Promise<void> {
    const uri = getChatSessionUri(sessionId);
    const alreadyOpen = this.lastOpenedChatSessionId === sessionId && this.hasChatSessionTab(uri);
    if (alreadyOpen) {
      return;
    }

    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    this.lastOpenedChatSessionId = sessionId;
    await delay(120);
  }

  private async sendMessageToChat(sessionId: string, message: string): Promise<void> {
    const { chatSendTarget } = this.getConfig();
    const uri = getChatSessionUri(sessionId);
    this.output.appendLine(`[bridge] sendMessage target=${chatSendTarget} session=${sessionId}`);

    if (chatSendTarget === 'panel') {
      // Open the exact session first so submission lands in the intended thread.
      await this.ensureChatSessionOpen(sessionId);
      await vscode.commands.executeCommand('workbench.action.chat.focusInput');
      await delay(50);
      await vscode.commands.executeCommand('workbench.action.chat.submit', { inputValue: message });
      this.output.appendLine(`[bridge] submit invoked in panel mode for session=${sessionId}`);
      await this.publishLiveHistoryForSession(sessionId).catch(() => undefined);
      this.monitorLiveHistory(sessionId);
      await delay(100);
      await vscode.commands.executeCommand('workbench.action.chat.open');
      return;
    }

    await vscode.commands.executeCommand('vscode.open', uri);
    await delay(150);
    await vscode.commands.executeCommand('workbench.action.chat.focusInput');
    await delay(50);
    await vscode.commands.executeCommand('workbench.action.chat.submit', { inputValue: message });
    this.output.appendLine(`[bridge] submit invoked in editor mode for session=${sessionId}`);
    await this.publishLiveHistoryForSession(sessionId).catch(() => undefined);
    this.monitorLiveHistory(sessionId);
  }

  private async openSessionInChat(sessionId: string): Promise<void> {
    const { chatSendTarget } = this.getConfig();

    await this.ensureChatSessionOpen(sessionId);
    await vscode.commands.executeCommand('workbench.action.chat.focusInput');

    if (chatSendTarget === 'panel') {
      await delay(80);
      await vscode.commands.executeCommand('workbench.action.chat.open');
    }
  }

  private monitorLiveHistory(sessionId: string): void {
    const existing = this.liveHistoryMonitorUntil.get(sessionId) ?? 0;
    const monitorUntil = Date.now() + HappyBridge.LIVE_HISTORY_MONITOR_MS;
    this.liveHistoryMonitorUntil.set(sessionId, Math.max(existing, monitorUntil));
  }

  private async publishMonitoredLiveHistory(): Promise<void> {
    if (this.liveHistorySyncing || this.liveHistoryMonitorUntil.size === 0) {
      return;
    }
    if (!this.client) {
      const recovered = await this.ensureClient('live history');
      if (!recovered || !this.client) return;
    }
    if (!this.client) {
      return;
    }

    this.liveHistorySyncing = true;
    try {
      const now = Date.now();
      for (const [sessionId, until] of this.liveHistoryMonitorUntil.entries()) {
        if (until <= now) {
          this.liveHistoryMonitorUntil.delete(sessionId);
          continue;
        }
        await this.publishLiveHistoryForSession(sessionId);
      }
    } finally {
      this.liveHistorySyncing = false;
    }
  }

  private async publishLiveHistoryForSession(sessionId: string): Promise<void> {
    if (!this.client) return;

    const messages = await this.exportLiveHistoryForSession(sessionId);
    if (!messages || messages.length === 0) {
      return;
    }

    const payloadHash = JSON.stringify(messages.map((message) => [message.role, message.text, message.timestamp]));
    if (this.liveHistoryHashes.get(sessionId) === payloadHash) {
      return;
    }

    await this.client.updateLiveHistory(this.instanceId, sessionId, messages, Date.now());
    this.liveHistoryHashes.set(sessionId, payloadHash);
    this.output.appendLine(`[bridge] Published live history for session=${sessionId} messages=${messages.length}`);
  }

  private async exportLiveHistoryForSession(sessionId: string): Promise<VscodeConversationMessage[] | undefined> {
    const { chatSendTarget } = this.getConfig();
    const uri = getChatSessionUri(sessionId);
    const exportPath = path.join(os.tmpdir(), `happy-vscode-export-${this.instanceId}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const exportUri = vscode.Uri.file(exportPath);

    try {
      if (chatSendTarget === 'panel') {
        await this.ensureChatSessionOpen(sessionId);
      } else {
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
        await delay(120);
      }
      await vscode.commands.executeCommand('workbench.action.chat.focusInput');
      await delay(50);
      await vscode.commands.executeCommand('workbench.action.chat.export', exportUri);
      await delay(30);

      const raw = await vscode.workspace.fs.readFile(exportUri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as ChatSessionExportJson;
      return extractMessagesFromExport(sessionId, parsed, 250);
    } catch (error) {
      this.output.appendLine(`[bridge] Live history export failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    } finally {
      try {
        await vscode.workspace.fs.delete(exportUri, { useTrash: false });
      } catch {
        // Ignore cleanup failures.
      }

      if (chatSendTarget === 'panel') {
        await delay(60);
        await vscode.commands.executeCommand('workbench.action.chat.open');
      }
    }
  }
}

let bridge: HappyBridge | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  console.log('[Happy VS Code Bridge] activated');
  output.appendLine('[bridge] Happy VS Code Bridge activated');
  context.subscriptions.push(output);
  bridge = new HappyBridge(output);
  await bridge.start(context);
  context.subscriptions.push({ dispose: () => bridge?.dispose() });
}

export function deactivate() {
  bridge?.dispose();
  bridge = null;
}
