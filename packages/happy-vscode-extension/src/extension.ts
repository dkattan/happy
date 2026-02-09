import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

import { DaemonClient, resolveBaseUrl, resolveDaemonStatePath, type VscodeCommand } from './daemonClient';
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

class HappyBridge {
  private output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  private instanceId = randomUUID();
  private client: DaemonClient | null = null;
  private timers: NodeJS.Timeout[] = [];
  private scanning = false;
  private polling = false;
  private lastSessionHash: string | null = null;

  async start(context: vscode.ExtensionContext): Promise<void> {
    await this.refreshClient();

    const configChange = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('happy.vscode')) {
        this.output.appendLine('[bridge] Configuration changed, reloading client.');
        this.refreshClient();
      }
    });
    context.subscriptions.push(configChange, this.output);

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

    this.timers.push(setInterval(() => void this.sendHeartbeat(), heartbeatInterval));
    this.timers.push(setInterval(() => void this.scanAndSendSessions(), scanInterval));
    this.timers.push(setInterval(() => void this.pollCommands(), commandInterval));

    void this.sendHeartbeat();
    void this.scanAndSendSessions();
    void this.pollCommands();
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
      commandPollIntervalMs
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
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.heartbeat(this.instanceId);
    } catch (error) {
      this.output.appendLine(`[bridge] Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.message.includes('404')) {
        await this.registerInstance().catch(() => undefined);
      }
    }
  }

  private async scanAndSendSessions(): Promise<void> {
    if (!this.client || this.scanning) return;
    this.scanning = true;
    try {
      const sessions = await scanVscodeSessions();
      const hash = JSON.stringify(sessions);
      if (hash !== this.lastSessionHash) {
        await this.client.updateSessions(this.instanceId, sessions);
        this.lastSessionHash = hash;
      }
    } catch (error) {
      this.output.appendLine(`[bridge] Session scan failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.message.includes('404')) {
        await this.registerInstance().catch(() => undefined);
      }
    } finally {
      this.scanning = false;
    }
  }

  private async pollCommands(): Promise<void> {
    if (!this.client || this.polling) return;
    this.polling = true;
    try {
      const commands = await this.client.getCommands(this.instanceId);
      for (const command of commands) {
        await this.handleCommand(command);
      }
    } catch (error) {
      this.output.appendLine(`[bridge] Command poll failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.message.includes('404')) {
        await this.registerInstance().catch(() => undefined);
      }
    } finally {
      this.polling = false;
    }
  }

  private async handleCommand(command: VscodeCommand): Promise<void> {
    if (!this.client) return;
    let ok = true;
    try {
      if (command.type === 'sendMessage') {
        await this.sendMessageToChat(command.sessionId, command.message);
      }
    } catch (error) {
      ok = false;
      this.output.appendLine(`[bridge] Command failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await this.client.ackCommand(this.instanceId, command.id, ok);
    }
  }

  private async sendMessageToChat(sessionId: string, message: string): Promise<void> {
    const encoded = base64UrlEncode(sessionId);
    const uri = vscode.Uri.parse(`vscode-chat-session://local/${encoded}`);

    await vscode.commands.executeCommand('vscode.open', uri);
    await delay(150);
    await vscode.commands.executeCommand('workbench.action.chat.focusInput');
    await delay(50);
    await vscode.commands.executeCommand('workbench.action.chat.submit', { inputValue: message });
  }
}

let bridge: HappyBridge | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  console.log('[Happy VS Code Bridge] activated');
  output.appendLine('[bridge] Happy VS Code Bridge activated');
  context.subscriptions.push(output);
  bridge = new HappyBridge();
  await bridge.start(context);
  context.subscriptions.push({ dispose: () => bridge?.dispose() });
}

export function deactivate() {
  bridge?.dispose();
  bridge = null;
}
