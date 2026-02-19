import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  getVscodeAppLabel,
  listVscodeRecentWorkspaces,
  resolveVscodeAppTarget,
  scanAllVscodeSessionsFromDisk,
  scanVscodeSessionsFromDisk,
  type VscodeAppTarget,
  type VscodeRecentWorkspaceSummary
} from './vscodeSessionScan';

export type VscodeSessionSummary = {
  id: string;
  title: string;
  lastMessageDate: number;
  needsInput: boolean;
  source: 'workspace' | 'empty-window';
  workspaceId?: string;
  workspaceDir?: string;
  workspaceFile?: string;
  workspacePathDisplay?: string;
  displayName?: string;
  jsonPath: string;
  instanceId: string;
};

export type VscodeFlatSessionSummary = Omit<VscodeSessionSummary, 'instanceId'> & {
  appTarget: VscodeAppTarget;
  appName: string;
  instanceId?: string;
  instanceLabel?: string;
  workspaceOpen: boolean;
  seenInLive: boolean;
  seenOnDisk: boolean;
};

export type VscodeRecentWorkspaceState = VscodeRecentWorkspaceSummary & {
  workspaceOpen: boolean;
  instanceId?: string;
  lastActivityAt?: number;
  seenInLive: boolean;
  seenOnDisk: boolean;
};

export type VscodeSearchEntity = 'sessions' | 'workspaces' | 'both';
export type VscodeSearchTextMode = 'contains' | 'regex';

export type VscodeSearchParams = {
  query?: string;
  entity: VscodeSearchEntity;
  appTarget?: VscodeAppTarget;
  appTargets?: VscodeAppTarget[];
  includeOpen?: boolean;
  includeClosed?: boolean;
  source?: {
    live?: boolean;
    disk?: boolean;
  };
  recency?: {
    since?: number;
    until?: number;
    lastDays?: number;
  };
  textMode?: VscodeSearchTextMode;
  limit?: number;
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
  } | {
    type: 'newConversation';
  }
);

export type VscodeConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  fileTrees?: VscodeConversationFileTree[];
};

export type VscodeConversationFileTreeNode = {
  label: string;
  children?: VscodeConversationFileTreeNode[];
};

export type VscodeConversationFileTree = {
  basePath?: string;
  roots: VscodeConversationFileTreeNode[];
};

export type VscodeConversationHistory = {
  session: VscodeSessionSummary;
  messages: VscodeConversationMessage[];
  updatedAt: number;
};

export type VscodeBridgeSnapshot = {
  instances: VscodeInstanceSummary[];
  sessions: VscodeSessionSummary[];
  flatSessions: VscodeFlatSessionSummary[];
  recentWorkspaces: VscodeRecentWorkspaceState[];
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

type VscodeGlobalScanState = {
  appTarget: VscodeAppTarget;
  appName: string;
  sessions: Omit<VscodeSessionSummary, 'instanceId'>[];
  recentWorkspaces: VscodeRecentWorkspaceSummary[];
  lastScanAt: number;
  scanInFlight: Promise<void> | null;
};

const STALE_INSTANCE_MS = 120000;
const SCAN_MIN_INTERVAL_MS = 15000;
const HOME_DIR = os.homedir();

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

function getPathTail(pathLike: string | null | undefined): string | undefined {
  if (!pathLike || typeof pathLike !== 'string') {
    return undefined;
  }
  const parts = pathLike.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

function resolveTildePath(pathLike: string | undefined): string | undefined {
  if (!pathLike) {
    return undefined;
  }
  if (pathLike === '~') {
    return HOME_DIR;
  }
  if (pathLike.startsWith('~/') || pathLike.startsWith('~\\')) {
    return path.join(HOME_DIR, pathLike.slice(2));
  }
  return pathLike;
}

function compactPathForDisplay(pathLike: string | undefined): string | undefined {
  const resolvedPath = resolveTildePath(pathLike);
  const normalizedPath = normalizePathLike(resolvedPath);
  if (!normalizedPath) {
    return undefined;
  }
  const normalizedHome = normalizePathLike(HOME_DIR);
  if (!normalizedHome) {
    return normalizedPath;
  }
  if (normalizedPath === normalizedHome) {
    return '~';
  }

  const homePrefix = `${normalizedHome}${path.sep}`;
  if (normalizedPath.startsWith(homePrefix)) {
    return `~${normalizedPath.slice(normalizedHome.length)}`;
  }
  return normalizedPath;
}

function getWorkspacePathDisplay(session: Pick<VscodeSessionSummary, 'workspaceDir' | 'workspaceFile'>): string | undefined {
  const workspaceDir = resolveTildePath(session.workspaceDir);
  if (workspaceDir) {
    return compactPathForDisplay(workspaceDir);
  }

  const workspaceFile = resolveTildePath(session.workspaceFile);
  if (!workspaceFile) {
    return undefined;
  }
  const directoryFromFile = path.dirname(workspaceFile);
  return compactPathForDisplay(directoryFromFile === '.' ? workspaceFile : directoryFromFile);
}

function extractUriPath(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const fsPath = asString(record.fsPath);
  if (fsPath && fsPath.length > 0) {
    return fsPath;
  }

  const pathValue = asString(record.path);
  if (pathValue && pathValue.length > 0) {
    return pathValue;
  }

  const external = asString(record.external);
  if (external && external.length > 0) {
    return external;
  }
  return undefined;
}

function toFileTreeNode(value: unknown): VscodeConversationFileTreeNode | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const label = asString(record.label)
    ?? asString(record.name)
    ?? getPathTail(extractUriPath(record.uri))
    ?? undefined;

  if (!label || label.length === 0) {
    return null;
  }

  const rawChildren = Array.isArray(record.children) ? record.children : [];
  const children = rawChildren
    .map((child) => toFileTreeNode(child))
    .filter((child): child is VscodeConversationFileTreeNode => child !== null);

  if (children.length > 0) {
    return { label, children };
  }
  return { label };
}

function toFileTrees(value: unknown, basePathHint?: string): VscodeConversationFileTree[] {
  const rootsSource = Array.isArray(value) ? value : [value];
  const roots = rootsSource
    .map((entry) => toFileTreeNode(entry))
    .filter((entry): entry is VscodeConversationFileTreeNode => entry !== null);

  if (roots.length === 0) {
    return [];
  }

  const compactBasePath = compactPathForDisplay(basePathHint);
  return [{
    basePath: compactBasePath,
    roots
  }];
}

function sanitizeFileTrees(value: unknown): VscodeConversationFileTree[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const trees: VscodeConversationFileTree[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const roots = Array.isArray(record.roots)
      ? record.roots
        .map((root) => toFileTreeNode(root))
        .filter((root): root is VscodeConversationFileTreeNode => root !== null)
      : [];
    if (roots.length === 0) {
      continue;
    }
    trees.push({
      basePath: compactPathForDisplay(asString(record.basePath)),
      roots
    });
  }
  return trees;
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

function extractAssistantPayload(request: ChatRequestRecord): {
  text: string;
  fileTrees: VscodeConversationFileTree[];
} {
  const response = Array.isArray(request.response) ? request.response : [];
  if (response.length === 0) {
    return { text: '', fileTrees: [] };
  }

  const chunks: string[] = [];
  const fileTrees: VscodeConversationFileTree[] = [];
  for (const entry of response) {
    const record = asRecord(entry);
    if (!record) continue;

    const kind = asString(record.kind)?.toLowerCase();
    if (kind === 'thinking' || kind === 'preparetoolinvocation' || kind === 'toolinvocationserialized' || kind === 'inlinereference' || kind === 'mcpserversstarting') {
      continue;
    }

    if (kind === 'treedata' || kind === 'filetree' || record.treeData !== undefined) {
      const treeData = record.treeData ?? record.value;
      const basePath = extractUriPath(record.uri) ?? extractUriPath(asRecord(record.treeData)?.uri);
      fileTrees.push(...toFileTrees(treeData, basePath));
      continue;
    }

    const text = asString(record.value) ?? asString(record.text) ?? asString(record.content) ?? asString(record.markdown);
    if (!text || text.trim().length === 0) continue;
    chunks.push(text);
  }

  return {
    text: chunks.join('').trim(),
    fileTrees
  };
}

export class VscodeBridge {
  private instances = new Map<string, VscodeInstanceState>();
  private globalScans = new Map<VscodeAppTarget, VscodeGlobalScanState>();

  constructor(private onUpdate?: (snapshot: VscodeBridgeSnapshot) => void) {
    this.ensureGlobalScanState('vscode');
    this.ensureGlobalScanState('insiders');
    this.scheduleGlobalScan();
  }

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
    this.scheduleGlobalScan(meta.appName);
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
    this.scheduleGlobalScan(instance.meta.appName);
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
    this.scheduleGlobalScan(instance.meta.appName);
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

    const sanitizedMessages: VscodeConversationMessage[] = [];
    for (const [index, message] of messages.entries()) {
      if (!message || (message.role !== 'user' && message.role !== 'assistant') || !Number.isFinite(message.timestamp)) {
        continue;
      }

      const text = typeof message.text === 'string' ? message.text : '';
      const fileTrees = sanitizeFileTrees((message as { fileTrees?: unknown }).fileTrees);
      const hasText = text.trim().length > 0;
      if (!hasText && fileTrees.length === 0) {
        continue;
      }

      sanitizedMessages.push({
        id: typeof message.id === 'string' && message.id.length > 0 ? message.id : `${sessionId}:live:${index}`,
        role: message.role,
        text,
        timestamp: message.timestamp,
        fileTrees: fileTrees.length > 0 ? fileTrees : undefined
      });
    }

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

  queueNewConversation(instanceId: string): { queued: true; commandId: string } | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    const command: VscodeCommand = {
      id: nextCommandId(),
      type: 'newConversation',
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

  search(params: VscodeSearchParams): {
    flatSessions?: VscodeFlatSessionSummary[];
    recentWorkspaces?: VscodeRecentWorkspaceState[];
  } {
    this.pruneStale();
    this.scheduleGlobalScan();

    const includeOpen = params.includeOpen ?? true;
    const includeClosed = params.includeClosed ?? true;
    const includeLive = params.source?.live ?? true;
    const includeDisk = params.source?.disk ?? true;
    const limit = Math.max(1, Math.min(500, Math.floor(params.limit ?? 100)));
    const appTargets = this.resolveSearchAppTargets(params.appTarget, params.appTargets);
    const textMode = params.textMode ?? 'contains';
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    const tokens = textMode === 'contains' ? this.getSearchTokens(query) : [];
    const regex = textMode === 'regex' ? this.compileSearchRegex(query) : null;
    const recencyWindow = this.getRecencyWindow(params.recency);

    const includeByOpenState = (workspaceOpen: boolean): boolean => (
      (workspaceOpen && includeOpen) || (!workspaceOpen && includeClosed)
    );
    const includeBySource = (seenInLive: boolean, seenOnDisk: boolean): boolean => (
      (includeLive && seenInLive) || (includeDisk && seenOnDisk)
    );

    const result: {
      flatSessions?: VscodeFlatSessionSummary[];
      recentWorkspaces?: VscodeRecentWorkspaceState[];
    } = {};

    if (params.entity === 'sessions' || params.entity === 'both') {
      const filteredSessions = this.getFlatSessions()
        .filter((session) => appTargets.has(session.appTarget))
        .filter((session) => includeByOpenState(session.workspaceOpen))
        .filter((session) => includeBySource(session.seenInLive, session.seenOnDisk))
        .filter((session) => this.matchesRecencyWindow(session.lastMessageDate, recencyWindow))
        .filter((session) => this.matchesSearchQuery(
          tokens,
          regex,
          [
            session.title,
            session.displayName,
            session.workspaceFile,
            session.workspaceDir,
            session.appName,
            session.instanceLabel,
            session.source,
            session.jsonPath
          ]
        ));

      result.flatSessions = filteredSessions.slice(0, limit);
    }

    if (params.entity === 'workspaces' || params.entity === 'both') {
      const appOrder: Record<VscodeAppTarget, number> = {
        vscode: 0,
        insiders: 1,
      };

      const filteredWorkspaces = this.getRecentWorkspaces()
        .filter((workspace) => appTargets.has(workspace.appTarget))
        .filter((workspace) => includeByOpenState(workspace.workspaceOpen))
        .filter((workspace) => includeBySource(workspace.seenInLive, workspace.seenOnDisk))
        .filter((workspace) => this.matchesRecencyWindow(workspace.lastActivityAt, recencyWindow))
        .filter((workspace) => this.matchesSearchQuery(
          tokens,
          regex,
          [
            workspace.label,
            workspace.path,
            workspace.kind,
            workspace.appName,
            workspace.id
          ]
        ))
        .sort((a, b) => {
          const activityDelta = (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
          if (activityDelta !== 0) {
            return activityDelta;
          }
          const rankDelta = (a.recentRank ?? Number.MAX_SAFE_INTEGER) - (b.recentRank ?? Number.MAX_SAFE_INTEGER);
          if (rankDelta !== 0) {
            return rankDelta;
          }
          if (a.workspaceOpen !== b.workspaceOpen) {
            return Number(b.workspaceOpen) - Number(a.workspaceOpen);
          }
          const appDelta = (appOrder[a.appTarget] ?? 99) - (appOrder[b.appTarget] ?? 99);
          if (appDelta !== 0) {
            return appDelta;
          }
          return a.label.localeCompare(b.label);
        });

      result.recentWorkspaces = filteredWorkspaces.slice(0, limit);
    }

    return result;
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
    const sessionWithDisplayPath: VscodeSessionSummary = {
      ...session,
      workspacePathDisplay: getWorkspacePathDisplay(session)
    };

    const effectiveLimit = Math.max(1, Math.floor(limit));
    const liveHistory = instance.liveHistoryBySession.get(sessionId);
    if (liveHistory && liveHistory.messages.length > 0) {
      const startIndex = Math.max(0, liveHistory.messages.length - effectiveLimit);
      return {
        session: sessionWithDisplayPath,
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

      const assistant = extractAssistantPayload(request);
      if (assistant.text.length > 0 || assistant.fileTrees.length > 0) {
        messages.push({
          id: `${sessionId}:a:${i}`,
          role: 'assistant',
          text: assistant.text,
          timestamp: timestamp + 1,
          fileTrees: assistant.fileTrees.length > 0 ? assistant.fileTrees : undefined
        });
      }
    }

    return {
      session: sessionWithDisplayPath,
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
    this.scheduleGlobalScan();
    const sessions = Array.from(this.instances.values()).flatMap((entry) => this.getMergedSessions(entry));
    const flatSessions = this.getFlatSessions();
    const recentWorkspaces = this.getRecentWorkspaces();
    const needsInputCount = flatSessions.filter((s) => s.needsInput).length;
    return {
      instances,
      sessions,
      flatSessions,
      recentWorkspaces,
      needsInputCount,
      updatedAt: nowMs()
    };
  }

  private ensureGlobalScanState(appTarget: VscodeAppTarget): VscodeGlobalScanState {
    const existing = this.globalScans.get(appTarget);
    if (existing) {
      return existing;
    }
    const created: VscodeGlobalScanState = {
      appTarget,
      appName: getVscodeAppLabel(appTarget),
      sessions: [],
      recentWorkspaces: [],
      lastScanAt: 0,
      scanInFlight: null
    };
    this.globalScans.set(appTarget, created);
    return created;
  }

  private scheduleGlobalScan(appName?: string): void {
    const appTargets: VscodeAppTarget[] = appName
      ? [resolveVscodeAppTarget(appName)]
      : ['vscode', 'insiders'];

    for (const appTarget of appTargets) {
      const state = this.ensureGlobalScanState(appTarget);
      if (state.scanInFlight || nowMs() - state.lastScanAt < SCAN_MIN_INTERVAL_MS) {
        continue;
      }
      state.scanInFlight = this.refreshGlobalScan(appTarget)
        .catch(() => undefined)
        .finally(() => {
          const current = this.globalScans.get(appTarget);
          if (current) {
            current.scanInFlight = null;
          }
        });
    }
  }

  private async refreshGlobalScan(appTarget: VscodeAppTarget): Promise<void> {
    const state = this.ensureGlobalScanState(appTarget);
    if (nowMs() - state.lastScanAt < SCAN_MIN_INTERVAL_MS) {
      return;
    }

    try {
      state.sessions = await scanAllVscodeSessionsFromDisk(state.appName);
      state.recentWorkspaces = listVscodeRecentWorkspaces(state.appName);
      state.lastScanAt = nowMs();
      this.emitUpdate();
    } catch {
      state.lastScanAt = nowMs();
    }
  }

  private getInstanceLabel(meta: VscodeInstanceMeta, fallbackInstanceId: string): string {
    const workspaceFileName = getPathTail(meta.workspaceFile);
    if (workspaceFileName) {
      return workspaceFileName;
    }

    if (Array.isArray(meta.workspaceFolders) && meta.workspaceFolders.length > 0) {
      const first = getPathTail(meta.workspaceFolders[0]) ?? 'Workspace';
      if (meta.workspaceFolders.length === 1) {
        return first;
      }
      return `${first} +${meta.workspaceFolders.length - 1}`;
    }

    if (meta.appName && meta.platform) {
      return `${meta.appName} (${meta.platform})`;
    }

    return `Window ${fallbackInstanceId.slice(0, 8)}`;
  }

  private getWorkspacePresenceByApp(): Map<VscodeAppTarget, {
    instanceByWorkspaceFile: Map<string, string>;
    instanceByWorkspaceDir: Map<string, string>;
    emptyWindowInstanceId?: string;
  }> {
    const presenceByApp = new Map<VscodeAppTarget, {
      instanceByWorkspaceFile: Map<string, string>;
      instanceByWorkspaceDir: Map<string, string>;
      emptyWindowInstanceId?: string;
    }>();

    const ensurePresence = (appTarget: VscodeAppTarget) => {
      const existing = presenceByApp.get(appTarget);
      if (existing) return existing;
      const created = {
        instanceByWorkspaceFile: new Map<string, string>(),
        instanceByWorkspaceDir: new Map<string, string>(),
        emptyWindowInstanceId: undefined as string | undefined
      };
      presenceByApp.set(appTarget, created);
      return created;
    };

    for (const [instanceId, instance] of this.instances.entries()) {
      const appTarget = resolveVscodeAppTarget(instance.meta.appName);
      const presence = ensurePresence(appTarget);

      const normalizedWorkspaceFile = normalizePathLike(instance.meta.workspaceFile ?? undefined);
      if (normalizedWorkspaceFile) {
        presence.instanceByWorkspaceFile.set(normalizedWorkspaceFile, instanceId);
      }

      const normalizedFolders = (instance.meta.workspaceFolders ?? [])
        .map((folder) => normalizePathLike(folder))
        .filter((folder): folder is string => Boolean(folder));

      for (const folder of normalizedFolders) {
        if (!presence.instanceByWorkspaceDir.has(folder)) {
          presence.instanceByWorkspaceDir.set(folder, instanceId);
        }
      }

      if (!normalizedWorkspaceFile && normalizedFolders.length === 0 && !presence.emptyWindowInstanceId) {
        presence.emptyWindowInstanceId = instanceId;
      }
    }

    return presenceByApp;
  }

  private resolveSessionOpenState(
    session: Pick<VscodeSessionSummary, 'source' | 'workspaceDir' | 'workspaceFile'> & { instanceId?: string },
    appTarget: VscodeAppTarget,
    presenceByApp: Map<VscodeAppTarget, {
      instanceByWorkspaceFile: Map<string, string>;
      instanceByWorkspaceDir: Map<string, string>;
      emptyWindowInstanceId?: string;
    }>
  ): { workspaceOpen: boolean; instanceId?: string } {
    if (session.instanceId && this.instances.has(session.instanceId)) {
      return { workspaceOpen: true, instanceId: session.instanceId };
    }

    const presence = presenceByApp.get(appTarget);
    if (!presence) {
      return { workspaceOpen: false };
    }

    const normalizedWorkspaceFile = normalizePathLike(session.workspaceFile ?? undefined);
    if (normalizedWorkspaceFile) {
      const instanceId = presence.instanceByWorkspaceFile.get(normalizedWorkspaceFile);
      if (instanceId) {
        return { workspaceOpen: true, instanceId };
      }
    }

    const normalizedWorkspaceDir = normalizePathLike(session.workspaceDir ?? undefined);
    if (normalizedWorkspaceDir) {
      const instanceId = presence.instanceByWorkspaceDir.get(normalizedWorkspaceDir);
      if (instanceId) {
        return { workspaceOpen: true, instanceId };
      }
    }

    if (session.source === 'empty-window' && presence.emptyWindowInstanceId) {
      return { workspaceOpen: true, instanceId: presence.emptyWindowInstanceId };
    }

    return { workspaceOpen: false };
  }

  private mergeFlatSession(
    existing: VscodeFlatSessionSummary,
    incoming: VscodeFlatSessionSummary
  ): VscodeFlatSessionSummary {
    return {
      ...existing,
      ...incoming,
      appTarget: existing.appTarget,
      appName: existing.appName || incoming.appName,
      title: incoming.title?.trim().length ? incoming.title : existing.title,
      lastMessageDate: Math.max(existing.lastMessageDate ?? 0, incoming.lastMessageDate ?? 0),
      needsInput: existing.needsInput || incoming.needsInput,
      workspaceId: incoming.workspaceId ?? existing.workspaceId,
      workspaceDir: incoming.workspaceDir ?? existing.workspaceDir,
      workspaceFile: incoming.workspaceFile ?? existing.workspaceFile,
      displayName: incoming.displayName ?? existing.displayName,
      workspaceOpen: existing.workspaceOpen || incoming.workspaceOpen,
      seenInLive: existing.seenInLive || incoming.seenInLive,
      seenOnDisk: existing.seenOnDisk || incoming.seenOnDisk,
      instanceId: existing.instanceId ?? incoming.instanceId,
      instanceLabel: existing.instanceLabel ?? incoming.instanceLabel,
      source: incoming.source ?? existing.source,
      jsonPath: incoming.jsonPath ?? existing.jsonPath,
      id: incoming.id || existing.id,
    };
  }

  private getFlatSessions(): VscodeFlatSessionSummary[] {
    const byKey = new Map<string, VscodeFlatSessionSummary>();
    const presenceByApp = this.getWorkspacePresenceByApp();

    for (const [instanceId, instance] of this.instances.entries()) {
      const appTarget = resolveVscodeAppTarget(instance.meta.appName);
      const appName = getVscodeAppLabel(appTarget);
      const instanceLabel = this.getInstanceLabel(instance.meta, instanceId);

      for (const session of this.getMergedSessions(instance)) {
        const key = this.buildSessionKey(session);
        const liveSession: VscodeFlatSessionSummary = {
          ...session,
          appTarget,
          appName,
          workspaceDir: session.workspaceDir ?? instance.meta.workspaceFolders?.[0] ?? undefined,
          workspaceFile: session.workspaceFile ?? instance.meta.workspaceFile ?? undefined,
          workspaceOpen: true,
          seenInLive: true,
          seenOnDisk: false,
          instanceId,
          instanceLabel
        };
        const existing = byKey.get(key);
        byKey.set(key, existing ? this.mergeFlatSession(existing, liveSession) : liveSession);
      }
    }

    for (const state of this.globalScans.values()) {
      for (const session of state.sessions) {
        const openState = this.resolveSessionOpenState(
          { ...session, instanceId: undefined },
          state.appTarget,
          presenceByApp
        );
        const instance = openState.instanceId ? this.instances.get(openState.instanceId) : undefined;
        const diskSession: VscodeFlatSessionSummary = {
          ...session,
          appTarget: state.appTarget,
          appName: state.appName,
          workspaceOpen: openState.workspaceOpen,
          seenInLive: openState.workspaceOpen,
          seenOnDisk: true,
          instanceId: openState.instanceId,
          instanceLabel: instance ? this.getInstanceLabel(instance.meta, openState.instanceId as string) : undefined,
        };
        const key = this.buildSessionKey(diskSession);
        const existing = byKey.get(key);
        byKey.set(key, existing ? this.mergeFlatSession(existing, diskSession) : diskSession);
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      if (a.workspaceOpen !== b.workspaceOpen) {
        return Number(b.workspaceOpen) - Number(a.workspaceOpen);
      }
      if (a.needsInput !== b.needsInput) {
        return Number(b.needsInput) - Number(a.needsInput);
      }
      return (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0);
    });
  }

  private getRecentWorkspaces(): VscodeRecentWorkspaceState[] {
    const byKey = new Map<string, VscodeRecentWorkspaceState>();
    const presenceByApp = this.getWorkspacePresenceByApp();
    const workspaceActivityByKey = new Map<string, number>();

    for (const session of this.getFlatSessions()) {
      const lastMessageDate = Number.isFinite(session.lastMessageDate) ? session.lastMessageDate : 0;
      if (lastMessageDate <= 0) {
        continue;
      }

      const updateWorkspaceActivity = (kind: VscodeRecentWorkspaceSummary['kind'], pathLike: string | undefined) => {
        if (!pathLike) {
          return;
        }
        const normalizedPath = normalizePathLike(pathLike) ?? pathLike;
        const key = `${session.appTarget}:${kind}:${normalizedPath}`;
        const existing = workspaceActivityByKey.get(key) ?? 0;
        if (lastMessageDate > existing) {
          workspaceActivityByKey.set(key, lastMessageDate);
        }
      };

      updateWorkspaceActivity('workspace-file', session.workspaceFile);
      updateWorkspaceActivity('folder', session.workspaceDir);
    }

    for (const state of this.globalScans.values()) {
      for (const workspace of state.recentWorkspaces) {
        const presence = presenceByApp.get(workspace.appTarget);
        const normalizedPath = normalizePathLike(workspace.path) ?? workspace.path;
        let instanceId: string | undefined;
        if (presence) {
          if (workspace.kind === 'workspace-file') {
            instanceId = presence.instanceByWorkspaceFile.get(normalizedPath);
          } else {
            instanceId = presence.instanceByWorkspaceDir.get(normalizedPath);
          }
        }

        const key = `${workspace.appTarget}:${workspace.kind}:${normalizedPath}`;
        const next: VscodeRecentWorkspaceState = {
          ...workspace,
          workspaceOpen: Boolean(instanceId),
          instanceId,
          lastActivityAt: workspaceActivityByKey.get(key),
          seenInLive: Boolean(instanceId),
          seenOnDisk: true,
        };
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, next);
          continue;
        }
        byKey.set(key, {
          ...existing,
          ...next,
          recentRank: Math.min(existing.recentRank, next.recentRank),
          workspaceOpen: existing.workspaceOpen || next.workspaceOpen,
          instanceId: existing.instanceId ?? next.instanceId,
          seenInLive: existing.seenInLive || next.seenInLive,
          seenOnDisk: existing.seenOnDisk || next.seenOnDisk,
          lastActivityAt: Math.max(existing.lastActivityAt ?? 0, next.lastActivityAt ?? 0) || undefined,
        });
      }
    }

    const appOrder: Record<VscodeAppTarget, number> = {
      vscode: 0,
      insiders: 1,
    };

    return Array.from(byKey.values()).sort((a, b) => {
      const activityDelta = (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
      if (activityDelta !== 0) {
        return activityDelta;
      }
      const rankDelta = (a.recentRank ?? Number.MAX_SAFE_INTEGER) - (b.recentRank ?? Number.MAX_SAFE_INTEGER);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      if (a.workspaceOpen !== b.workspaceOpen) {
        return Number(b.workspaceOpen) - Number(a.workspaceOpen);
      }
      const appDelta = (appOrder[a.appTarget] ?? 99) - (appOrder[b.appTarget] ?? 99);
      if (appDelta !== 0) {
        return appDelta;
      }
      return a.label.localeCompare(b.label);
    });
  }

  private buildSessionKey(session: Pick<VscodeSessionSummary, 'id' | 'jsonPath'>): string {
    const normalizedPath = normalizePathLike(session.jsonPath) ?? session.jsonPath;
    return `${session.id}::${normalizedPath}`;
  }

  private resolveSearchAppTargets(
    appTarget?: VscodeAppTarget,
    appTargets?: VscodeAppTarget[]
  ): Set<VscodeAppTarget> {
    if (Array.isArray(appTargets) && appTargets.length > 0) {
      return new Set(appTargets.filter((value): value is VscodeAppTarget => value === 'vscode' || value === 'insiders'));
    }
    if (appTarget) {
      return new Set([appTarget]);
    }
    return new Set<VscodeAppTarget>(['vscode', 'insiders']);
  }

  private compileSearchRegex(query: string): RegExp | null {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      return new RegExp(trimmed, 'i');
    } catch (error) {
      throw new Error(`Invalid regex query: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getRecencyWindow(recency: VscodeSearchParams['recency']): { since?: number; until?: number } | null {
    if (!recency) {
      return null;
    }

    let since = Number.isFinite(recency.since) ? Number(recency.since) : undefined;
    let until = Number.isFinite(recency.until) ? Number(recency.until) : undefined;
    if (Number.isFinite(recency.lastDays)) {
      const days = Number(recency.lastDays);
      if (days < 0) {
        throw new Error('recency.lastDays must be non-negative');
      }
      const fromLastDays = nowMs() - Math.floor(days * 24 * 60 * 60 * 1000);
      since = typeof since === 'number' ? Math.max(since, fromLastDays) : fromLastDays;
    }

    if (typeof since === 'number' && typeof until === 'number' && since > until) {
      throw new Error('recency.since must be less than or equal to recency.until');
    }

    if (typeof since !== 'number' && typeof until !== 'number') {
      return null;
    }

    return { since, until };
  }

  private matchesRecencyWindow(
    value: number | undefined,
    window: { since?: number; until?: number } | null
  ): boolean {
    if (!window) {
      return true;
    }
    if (!Number.isFinite(value)) {
      return false;
    }
    if (typeof window.since === 'number' && (value as number) < window.since) {
      return false;
    }
    if (typeof window.until === 'number' && (value as number) > window.until) {
      return false;
    }
    return true;
  }

  private matchesSearchQuery(
    tokens: string[],
    regex: RegExp | null,
    fields: Array<string | undefined>
  ): boolean {
    if (!regex && tokens.length === 0) {
      return true;
    }
    const searchable = fields
      .filter((field): field is string => typeof field === 'string' && field.length > 0)
      .join('\n');
    if (searchable.length === 0) {
      return false;
    }
    if (regex) {
      return regex.test(searchable);
    }
    return this.matchesSearchTokens(tokens, [searchable]);
  }

  private getSearchTokens(query: string): string[] {
    const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (normalized.length === 0) {
      return [];
    }
    return normalized.split(/\s+/).filter((token) => token.length > 0).slice(0, 8);
  }

  private matchesSearchTokens(tokens: string[], fields: Array<string | undefined>): boolean {
    if (tokens.length === 0) {
      return true;
    }
    const searchable = fields
      .filter((field): field is string => typeof field === 'string' && field.length > 0)
      .join('\n')
      .toLowerCase();
    if (searchable.length === 0) {
      return false;
    }
    return tokens.every((token) => searchable.includes(token));
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
      workspaceFile: incoming.workspaceFile ?? existing.workspaceFile,
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
