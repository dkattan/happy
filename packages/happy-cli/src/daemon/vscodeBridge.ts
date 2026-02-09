import { randomUUID } from 'crypto';

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
  instanceId: string;
};

export type VscodeInstanceMeta = {
  instanceId: string;
  appName: string;
  appVersion: string;
  platform: string;
  pid: number;
  workspaceFolders: string[];
  workspaceFile?: string | null;
};

export type VscodeInstanceSummary = VscodeInstanceMeta & {
  lastSeen: number;
};

export type VscodeCommand = {
  id: string;
  type: 'sendMessage';
  sessionId: string;
  message: string;
  createdAt: number;
};

export type VscodeBridgeSnapshot = {
  instances: VscodeInstanceSummary[];
  sessions: VscodeSessionSummary[];
  needsInputCount: number;
  updatedAt: number;
};

type VscodeInstanceState = {
  meta: VscodeInstanceMeta;
  lastSeen: number;
  sessions: VscodeSessionSummary[];
  commands: VscodeCommand[];
};

const STALE_INSTANCE_MS = 120000;

function nowMs(): number {
  return Date.now();
}

function nextCommandId(): string {
  return `cmd_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

export class VscodeBridge {
  private instances = new Map<string, VscodeInstanceState>();

  constructor(private onUpdate?: (snapshot: VscodeBridgeSnapshot) => void) {}

  register(meta: VscodeInstanceMeta): void {
    this.instances.set(meta.instanceId, {
      meta,
      lastSeen: nowMs(),
      sessions: [],
      commands: []
    });
    this.emitUpdate();
  }

  heartbeat(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    instance.lastSeen = nowMs();
    this.emitUpdate();
    return true;
  }

  updateSessions(instanceId: string, sessions: Omit<VscodeSessionSummary, 'instanceId'>[]): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    instance.lastSeen = nowMs();
    instance.sessions = sessions.map((session) => ({
      ...session,
      instanceId
    }));
    this.emitUpdate();
    return true;
  }

  listInstances(): VscodeInstanceSummary[] {
    this.pruneStale();
    return Array.from(this.instances.values()).map((entry) => ({
      ...entry.meta,
      lastSeen: entry.lastSeen
    }));
  }

  listSessions(instanceId: string): VscodeSessionSummary[] {
    this.pruneStale();
    const instance = this.instances.get(instanceId);
    return instance ? instance.sessions : [];
  }

  listCommands(instanceId: string): VscodeCommand[] {
    const instance = this.instances.get(instanceId);
    return instance ? instance.commands : [];
  }

  hasInstance(instanceId: string): boolean {
    this.pruneStale();
    return this.instances.has(instanceId);
  }

  queueSendMessage(instanceId: string, sessionId: string, message: string): { queued: true; commandId: string } | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    const command: VscodeCommand = {
      id: nextCommandId(),
      type: 'sendMessage',
      sessionId,
      message,
      createdAt: nowMs()
    };
    instance.commands.push(command);
    this.emitUpdate();
    return { queued: true, commandId: command.id };
  }

  ackCommand(instanceId: string, commandId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    instance.commands = instance.commands.filter((cmd) => cmd.id !== commandId);
    return true;
  }

  getSnapshot(): VscodeBridgeSnapshot {
    const instances = this.listInstances();
    const sessions = Array.from(this.instances.values()).flatMap((entry) => entry.sessions);
    const needsInputCount = sessions.filter((s) => s.needsInput).length;
    return {
      instances,
      sessions,
      needsInputCount,
      updatedAt: nowMs()
    };
  }

  private emitUpdate(): void {
    if (!this.onUpdate) return;
    this.onUpdate(this.getSnapshot());
  }

  private pruneStale(): void {
    const cutoff = nowMs() - STALE_INSTANCE_MS;
    for (const [instanceId, instance] of this.instances.entries()) {
      if (instance.lastSeen < cutoff) {
        this.instances.delete(instanceId);
      }
    }
  }
}
