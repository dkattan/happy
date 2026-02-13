import fs from 'fs';
import path from 'path';

export type VscodeInstanceRegistration = {
  instanceId: string;
  appName: string;
  appVersion: string;
  platform: string;
  pid: number;
  workspaceFolders: string[];
  workspaceFile?: string | null;
};

export type VscodeSessionSummary = {
  id: string;
  title: string;
  lastMessageDate: number;
  needsInput: boolean;
  source: 'workspace' | 'empty-window';
  workspaceId?: string;
  workspaceDir?: string;
  displayName?: string;
  jsonPath: string;
};

export type VscodeCommand = {
  id: string;
  createdAt: number;
} & (
  {
    type: 'sendMessage';
    sessionId: string;
    message: string;
  } | {
    type: 'openSession';
    sessionId: string;
  }
);

export type VscodeConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
};

export type DaemonClientConfig = {
  baseUrl: string;
};

export class DaemonClient {
  constructor(private config: DaemonClientConfig) {}

  async register(meta: VscodeInstanceRegistration): Promise<void> {
    await this.post('/vscode/register', meta);
  }

  async heartbeat(instanceId: string): Promise<void> {
    await this.post('/vscode/heartbeat', { instanceId });
  }

  async updateSessions(instanceId: string, sessions: VscodeSessionSummary[]): Promise<void> {
    await this.post('/vscode/sessions', { instanceId, sessions });
  }

  async updateLiveHistory(instanceId: string, sessionId: string, messages: VscodeConversationMessage[], updatedAt: number): Promise<void> {
    await this.post('/vscode/live-history', { instanceId, sessionId, messages, updatedAt });
  }

  async getCommands(instanceId: string): Promise<VscodeCommand[]> {
    const data = await this.get(`/vscode/instances/${encodeURIComponent(instanceId)}/commands`);
    return Array.isArray(data?.commands) ? data.commands : [];
  }

  async ackCommand(instanceId: string, commandId: string, ok: boolean): Promise<void> {
    await this.post(`/vscode/instances/${encodeURIComponent(instanceId)}/commands/${encodeURIComponent(commandId)}/ack`, { ok });
  }

  private async get(pathname: string): Promise<any> {
    const url = new URL(pathname, this.config.baseUrl);
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status}`);
    }
    return response.json();
  }

  private async post(pathname: string, body: unknown): Promise<any> {
    const url = new URL(pathname, this.config.baseUrl);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status}`);
    }
    return response.json();
  }
}

export function resolveBaseUrl(opts: {
  daemonBaseUrl?: string;
  daemonHttpPort?: number;
  daemonStatePath?: string;
}): string | null {
  if (opts.daemonBaseUrl && opts.daemonBaseUrl.trim().length > 0) {
    return opts.daemonBaseUrl.trim();
  }

  if (opts.daemonHttpPort && opts.daemonHttpPort > 0) {
    return `http://127.0.0.1:${opts.daemonHttpPort}`;
  }

  const statePath = opts.daemonStatePath && opts.daemonStatePath.trim().length > 0 ? opts.daemonStatePath : undefined;
  if (!statePath) return null;

  try {
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, 'utf8');
    const json = JSON.parse(raw) as { httpPort?: number };
    if (!json?.httpPort) return null;
    return `http://127.0.0.1:${json.httpPort}`;
  } catch {
    return null;
  }
}

export function resolveDaemonStatePath(candidate: string | undefined, fallback: string): string {
  if (candidate && candidate.trim().length > 0) {
    const trimmed = candidate.trim();
    if (trimmed.startsWith('~')) {
      return path.join(require('os').homedir(), trimmed.slice(1));
    }
    return trimmed;
  }
  return fallback;
}
