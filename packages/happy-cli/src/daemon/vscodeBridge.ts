import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { scanVscodeSessionsFromDisk } from './vscodeSessionScan';

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

export type VscodeConversationHistory = {
  session: VscodeSessionSummary;
  messages: VscodeConversationMessage[];
  updatedAt: number;
};

export type VscodeBridgeSnapshot = {
  instances: VscodeInstanceSummary[];
  sessions: VscodeSessionSummary[];
  needsInputCount: number;
  updatedAt: number;
};

type ChatRequestRecord = {
  message?: unknown;
  response?: unknown;
  timestamp?: unknown;
};

type ChatSessionJson = {
  requests?: unknown;
  creationDate?: unknown;
};

type VscodeLiveHistoryEntry = {
  messages: VscodeConversationMessage[];
  updatedAt: number;
};

type VscodeInstanceState = {
  meta: VscodeInstanceMeta;
  lastSeen: number;
  reportedSessions: VscodeSessionSummary[];
  scannedSessions: VscodeSessionSummary[];
  liveHistoryBySession: Map<string, VscodeLiveHistoryEntry>;
  lastScanAt: number;
  scanInFlight: Promise<void> | null;
  commands: VscodeCommand[];
};

const STALE_INSTANCE_MS = 120000;
const SCAN_MIN_INTERVAL_MS = 15000;

function nowMs(): number {
  return Date.now();
}

function nextCommandId(): string {
  return `cmd_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asPath(value: unknown): Array<string | number> | undefined {
  if (!Array.isArray(value)) return undefined;
  const pathSegments: Array<string | number> = [];
  for (const segment of value) {
    if (typeof segment === 'string' || typeof segment === 'number') {
      pathSegments.push(segment);
      continue;
    }
    return undefined;
  }
  return pathSegments;
}

function normalizePathLike(value: string | null | undefined): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const normalized = path.normalize(value).replace(/[\\/]+$/, '');
  if (normalized.length === 0) {
    return undefined;
  }
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

function setPathValue(rootValue: unknown, objectPath: Array<string | number>, nextValue: unknown): unknown {
  if (objectPath.length === 0) {
    return nextValue;
  }

  let root: unknown = rootValue;
  if (!root || typeof root !== 'object') {
    root = typeof objectPath[0] === 'number' ? [] : {};
  }

  let current = root as Record<string | number, unknown>;
  for (let i = 0; i < objectPath.length - 1; i++) {
    const key = objectPath[i];
    const existing = current[key];
    if (!existing || typeof existing !== 'object') {
      const nextKey = objectPath[i + 1];
      current[key] = typeof nextKey === 'number' ? [] : {};
    }
    current = current[key] as Record<string | number, unknown>;
  }

  current[objectPath[objectPath.length - 1]] = nextValue;
  return root;
}

function pushPathValues(
  rootValue: unknown,
  objectPath: Array<string | number>,
  values: unknown[] | undefined,
  startIndex: number | undefined
): unknown {
  if (objectPath.length === 0) {
    return rootValue;
  }

  let root: unknown = rootValue;
  if (!root || typeof root !== 'object') {
    root = typeof objectPath[0] === 'number' ? [] : {};
  }

  let current = root as Record<string | number, unknown>;
  for (let i = 0; i < objectPath.length - 1; i++) {
    const key = objectPath[i];
    const existing = current[key];
    if (!existing || typeof existing !== 'object') {
      const nextKey = objectPath[i + 1];
      current[key] = typeof nextKey === 'number' ? [] : {};
    }
    current = current[key] as Record<string | number, unknown>;
  }

  const arrayKey = objectPath[objectPath.length - 1];
  const existingArray = current[arrayKey];
  const targetArray = Array.isArray(existingArray) ? existingArray : [];
  if (typeof startIndex === 'number' && Number.isFinite(startIndex) && startIndex >= 0) {
    targetArray.length = startIndex;
  }
  if (Array.isArray(values) && values.length > 0) {
    targetArray.push(...values);
  }
  current[arrayKey] = targetArray;
  return root;
}

function readJsonMutationLog(filePath: string): unknown | undefined {
  let raw = '';
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return undefined;
  }

  let state: unknown;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record) continue;
    const kind = asNumber(record['kind']);
    const objectPath = asPath(record['k']);

    if (kind === 0) {
      state = record['v'];
    } else if (kind === 1 && objectPath) {
      state = setPathValue(state, objectPath, record['v']);
    } else if (kind === 2 && objectPath) {
      const values = Array.isArray(record['v']) ? record['v'] : undefined;
      const startIndex = asNumber(record['i']);
      state = pushPathValues(state, objectPath, values, startIndex);
    } else if (kind === 3 && objectPath) {
      state = setPathValue(state, objectPath, undefined);
    }
  }

  return state;
}

function readSessionJson(filePath: string): ChatSessionJson {
  try {
    if (filePath.endsWith('.jsonl')) {
      const parsed = readJsonMutationLog(filePath);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSONL chat session data');
      }
      return parsed as ChatSessionJson;
    }
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as ChatSessionJson;
  } catch (error) {
    throw new Error(`Failed to read VS Code session history: ${error instanceof Error ? error.message : String(error)}`);
  }
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

export class VscodeBridge {
  private instances = new Map<string, VscodeInstanceState>();

  constructor(private onUpdate?: (snapshot: VscodeBridgeSnapshot) => void) {}

  async register(meta: VscodeInstanceMeta): Promise<void> {
    const existing = this.instances.get(meta.instanceId);
    let scannedSessions = existing?.scannedSessions ?? [];
    try {
      scannedSessions = await this.scanSessionsForMeta(meta, meta.instanceId);
    } catch {
      // Keep registration resilient even when scanner hits transient file read errors.
    }
    this.instances.set(meta.instanceId, {
      meta,
      lastSeen: nowMs(),
      reportedSessions: existing?.reportedSessions ?? [],
      scannedSessions,
      liveHistoryBySession: existing?.liveHistoryBySession ?? new Map<string, VscodeLiveHistoryEntry>(),
      lastScanAt: nowMs(),
      scanInFlight: null,
      commands: existing?.commands ?? []
    });
    this.emitUpdate();
  }

  heartbeat(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    instance.lastSeen = nowMs();
    if (!instance.scanInFlight && nowMs() - instance.lastScanAt >= SCAN_MIN_INTERVAL_MS) {
      instance.scanInFlight = this.refreshScannedSessions(instanceId)
        .catch(() => undefined)
        .finally(() => {
          const current = this.instances.get(instanceId);
          if (current) {
            current.scanInFlight = null;
          }
        });
    }
    this.emitUpdate();
    return true;
  }

  async updateSessions(instanceId: string, sessions: Omit<VscodeSessionSummary, 'instanceId'>[]): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    instance.lastSeen = nowMs();
    instance.reportedSessions = sessions.map((session) => ({
      ...session,
      instanceId
    }));
    if (!instance.scanInFlight && nowMs() - instance.lastScanAt >= SCAN_MIN_INTERVAL_MS) {
      instance.scanInFlight = this.refreshScannedSessions(instanceId)
        .catch(() => undefined)
        .finally(() => {
          const current = this.instances.get(instanceId);
          if (current) {
            current.scanInFlight = null;
          }
        });
      await instance.scanInFlight;
    }
    this.emitUpdate();
    return true;
  }

  updateLiveHistory(
    instanceId: string,
    sessionId: string,
    messages: VscodeConversationMessage[],
    updatedAt?: number
  ): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    const sanitizedMessages = messages
      .filter((message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.text === 'string' &&
        message.text.trim().length > 0 &&
        Number.isFinite(message.timestamp)
      )
      .map((message, index) => ({
        id: typeof message.id === 'string' && message.id.length > 0 ? message.id : `${sessionId}:live:${index}`,
        role: message.role,
        text: message.text,
        timestamp: message.timestamp
      }));

    instance.liveHistoryBySession.set(sessionId, {
      messages: sanitizedMessages.slice(-500),
      updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : nowMs()
    });
    instance.lastSeen = nowMs();
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
    return instance ? this.getMergedSessions(instance) : [];
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

  queueOpenSession(instanceId: string, sessionId: string): { queued: true; commandId: string } | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    const command: VscodeCommand = {
      id: nextCommandId(),
      type: 'openSession',
      sessionId,
      createdAt: nowMs()
    };
    instance.commands.push(command);
    this.emitUpdate();
    return { queued: true, commandId: command.id };
  }

  findSessionInstance(sessionId: string): string | null {
    this.pruneStale();
    for (const [instanceId, instance] of this.instances.entries()) {
      if (this.getMergedSessions(instance).some((session) => session.id === sessionId)) {
        return instanceId;
      }
    }
    return null;
  }

  findInstanceForWorkspace(workspaceDir?: string, workspaceFile?: string | null): string | null {
    this.pruneStale();
    const normalizedWorkspaceDir = normalizePathLike(workspaceDir);
    const normalizedWorkspaceFile = normalizePathLike(workspaceFile ?? undefined);

    for (const [instanceId, instance] of this.instances.entries()) {
      const normalizedInstanceWorkspaceFile = normalizePathLike(instance.meta.workspaceFile ?? undefined);
      const normalizedInstanceFolders = new Set(
        (instance.meta.workspaceFolders ?? [])
          .map((folder) => normalizePathLike(folder))
          .filter((folder): folder is string => Boolean(folder))
      );

      if (normalizedWorkspaceFile && normalizedInstanceWorkspaceFile === normalizedWorkspaceFile) {
        return instanceId;
      }

      if (normalizedWorkspaceDir && normalizedInstanceFolders.has(normalizedWorkspaceDir)) {
        return instanceId;
      }
    }

    return null;
  }

  getSessionHistory(instanceId: string, sessionId: string, limit: number = 200): VscodeConversationHistory {
    this.pruneStale();
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error('VS Code instance not found');
    }

    const session = this.getMergedSessions(instance).find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new Error('VS Code session not found');
    }

    const effectiveLimit = Math.max(1, Math.floor(limit));
    const liveHistory = instance.liveHistoryBySession.get(sessionId);
    if (liveHistory && liveHistory.messages.length > 0) {
      const startIndex = Math.max(0, liveHistory.messages.length - effectiveLimit);
      return {
        session,
        messages: liveHistory.messages.slice(startIndex),
        updatedAt: liveHistory.updatedAt
      };
    }

    const parsed = readSessionJson(session.jsonPath);

    const requests = Array.isArray(parsed.requests) ? parsed.requests as ChatRequestRecord[] : [];
    const startIndex = Math.max(0, requests.length - effectiveLimit);
    const baseTimestamp = asNumber(parsed.creationDate) ?? nowMs();

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

    return {
      session,
      messages,
      updatedAt: nowMs()
    };
  }

  ackCommand(instanceId: string, commandId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    instance.commands = instance.commands.filter((cmd) => cmd.id !== commandId);
    return true;
  }

  getSnapshot(): VscodeBridgeSnapshot {
    const instances = this.listInstances();
    const sessions = Array.from(this.instances.values()).flatMap((entry) => this.getMergedSessions(entry));
    const needsInputCount = sessions.filter((s) => s.needsInput).length;
    return {
      instances,
      sessions,
      needsInputCount,
      updatedAt: nowMs()
    };
  }

  private buildSessionKey(session: VscodeSessionSummary): string {
    const normalizedPath = normalizePathLike(session.jsonPath) ?? session.jsonPath;
    return `${session.id}::${normalizedPath}`;
  }

  private mergeSession(
    existing: VscodeSessionSummary,
    incoming: VscodeSessionSummary
  ): VscodeSessionSummary {
    const mergedLastMessageDate = Math.max(existing.lastMessageDate ?? 0, incoming.lastMessageDate ?? 0);
    return {
      ...existing,
      ...incoming,
      title: incoming.title?.trim().length ? incoming.title : existing.title,
      lastMessageDate: mergedLastMessageDate,
      needsInput: existing.needsInput || incoming.needsInput,
      source: incoming.source ?? existing.source,
      workspaceId: incoming.workspaceId ?? existing.workspaceId,
      workspaceDir: incoming.workspaceDir ?? existing.workspaceDir,
      displayName: incoming.displayName ?? existing.displayName,
      jsonPath: incoming.jsonPath ?? existing.jsonPath,
      instanceId: existing.instanceId
    };
  }

  private getMergedSessions(instance: VscodeInstanceState): VscodeSessionSummary[] {
    const byKey = new Map<string, VscodeSessionSummary>();

    for (const session of instance.scannedSessions) {
      byKey.set(this.buildSessionKey(session), session);
    }
    for (const session of instance.reportedSessions) {
      const key = this.buildSessionKey(session);
      const existing = byKey.get(key);
      if (existing) {
        byKey.set(key, this.mergeSession(existing, session));
      } else {
        byKey.set(key, session);
      }
    }

    return Array.from(byKey.values()).sort((a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0));
  }

  private async scanSessionsForMeta(
    meta: VscodeInstanceMeta,
    instanceId: string
  ): Promise<VscodeSessionSummary[]> {
    const sessions = await scanVscodeSessionsFromDisk({
      appName: meta.appName,
      workspaceFolders: meta.workspaceFolders ?? [],
      workspaceFile: meta.workspaceFile ?? null
    });

    return sessions.map((session) => ({
      ...session,
      instanceId,
    }));
  }

  private async refreshScannedSessions(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    try {
      const scannedSessions = await this.scanSessionsForMeta(instance.meta, instanceId);
      const current = this.instances.get(instanceId);
      if (!current) return;

      current.scannedSessions = scannedSessions;
      current.lastScanAt = nowMs();
      this.emitUpdate();
    } catch {
      const current = this.instances.get(instanceId);
      if (current) {
        current.lastScanAt = nowMs();
      }
    }
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
