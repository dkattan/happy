import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import type { VscodeInstanceMeta, VscodeSessionSummary } from './vscodeBridge';

type ScanContext = Pick<VscodeInstanceMeta, 'appName' | 'workspaceFolders' | 'workspaceFile'>;

type WorkspaceMeta = {
  folder?: string;
  workspaceFile?: string;
};

type WorkspaceRecord = {
  id: string;
  workspaceDir: string;
  sessionsDir: string;
  displayName: string;
  metaFolderPath?: string;
  metaWorkspaceFilePath?: string;
};

function isInsidersApp(appName?: string): boolean {
  return typeof appName === 'string' && appName.toLowerCase().includes('insider');
}

function getDefaultWorkspaceStorageRoots(appName?: string): string[] {
  const home = os.homedir();
  const platform = process.platform;
  const insiders = isInsidersApp(appName);

  if (platform === 'darwin') {
    return insiders
      ? [path.join(home, 'Library/Application Support/Code - Insiders/User/workspaceStorage')]
      : [path.join(home, 'Library/Application Support/Code/User/workspaceStorage')];
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData/Roaming');
    return insiders
      ? [path.join(appData, 'Code - Insiders/User/workspaceStorage')]
      : [path.join(appData, 'Code/User/workspaceStorage')];
  }

  return insiders
    ? [path.join(home, '.config/Code - Insiders/User/workspaceStorage')]
    : [path.join(home, '.config/Code/User/workspaceStorage')];
}

function getDefaultGlobalStorageRoots(appName?: string): string[] {
  const home = os.homedir();
  const platform = process.platform;
  const insiders = isInsidersApp(appName);

  if (platform === 'darwin') {
    return insiders
      ? [path.join(home, 'Library/Application Support/Code - Insiders/User/globalStorage')]
      : [path.join(home, 'Library/Application Support/Code/User/globalStorage')];
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData/Roaming');
    return insiders
      ? [path.join(appData, 'Code - Insiders/User/globalStorage')]
      : [path.join(appData, 'Code/User/globalStorage')];
  }

  return insiders
    ? [path.join(home, '.config/Code - Insiders/User/globalStorage')]
    : [path.join(home, '.config/Code/User/globalStorage')];
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
  if (!value || typeof value !== 'string') return undefined;

  let resolved = value;
  if (resolved.startsWith('file://')) {
    try {
      resolved = fileURLToPath(resolved);
    } catch {
      resolved = resolved.slice('file://'.length);
    }
  }

  const normalized = path.normalize(resolved).replace(/[\\/]+$/, '');
  if (normalized.length === 0) return undefined;

  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
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
    raw = fs.readFileSync(filePath, 'utf8');
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

function readSessionJson(filePath: string): unknown | undefined {
  if (filePath.endsWith('.jsonl')) {
    return readJsonMutationLog(filePath);
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readWorkspaceMeta(workspaceDir: string): WorkspaceMeta {
  const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');
  if (!fs.existsSync(workspaceJsonPath)) return {};

  const json = readSessionJson(workspaceJsonPath);
  if (!json || typeof json !== 'object') return {};
  const record = json as Record<string, unknown>;

  const meta: WorkspaceMeta = {};
  const folder = record.folder;
  if (typeof folder === 'string') {
    meta.folder = folder;
  } else if (folder && typeof folder === 'object') {
    const folderObj = folder as Record<string, unknown>;
    if (typeof folderObj.path === 'string') {
      meta.folder = folderObj.path;
    }
  }

  const workspaceFile = record.workspace;
  if (typeof workspaceFile === 'string') {
    meta.workspaceFile = workspaceFile;
  }

  return meta;
}

function getDisplayNameFromMeta(workspaceId: string, meta: WorkspaceMeta): string {
  const short = workspaceId.slice(0, 8);
  const fromPath = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    try {
      const cleaned = value.startsWith('file://') ? fileURLToPath(value) : value;
      const base = path.basename(cleaned);
      return base || undefined;
    } catch {
      return undefined;
    }
  };

  const folderName = fromPath(meta.folder);
  if (folderName) return `${folderName} (${short}...)`;

  const workspaceName = fromPath(meta.workspaceFile);
  if (workspaceName) return `${workspaceName} (${short}...)`;

  return `Unknown (${short}...)`;
}

function getFirstMessageText(json: unknown): string | undefined {
  const record = asRecord(json);
  if (!record) return undefined;

  const requests = Array.isArray(record.requests) ? record.requests : [];
  const first = requests[0];
  const firstRecord = asRecord(first);
  if (!firstRecord) return undefined;

  const message = asRecord(firstRecord.message ?? firstRecord);
  if (!message) return undefined;

  const direct = asString(message.text) ?? asString(message.content);
  if (direct) return direct;

  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (const part of parts) {
    const partRecord = asRecord(part);
    const text = partRecord ? asString(partRecord.text) : undefined;
    if (text) return text;
  }

  return undefined;
}

function getLastMessageDate(json: unknown): number | undefined {
  const rec = asRecord(json);
  if (!rec) return undefined;

  const explicit = asNumber(rec['lastMessageDate']);
  if (explicit && explicit > 0) return explicit;

  const requests = Array.isArray(rec['requests']) ? rec['requests'] : [];
  for (let i = requests.length - 1; i >= 0; i--) {
    const req = asRecord(requests[i]);
    const timestamp = asNumber(req?.['timestamp']);
    if (timestamp && timestamp > 0) return timestamp;
  }

  const created = asNumber(rec['creationDate']);
  if (created && created > 0) return created;
  return undefined;
}

function getNeedsInput(json: unknown): boolean | undefined {
  const rec = asRecord(json);
  if (!rec) return undefined;
  const requests = Array.isArray(rec['requests']) ? rec['requests'] : [];
  if (requests.length === 0) return false;

  const lastReq = asRecord(requests[requests.length - 1]);
  if (!lastReq) return false;

  const modelStateRaw = lastReq['modelState'];
  if (typeof modelStateRaw === 'number') {
    return modelStateRaw === 4;
  }
  const modelState = asRecord(modelStateRaw);
  if (modelState) {
    const stateValue = asNumber(modelState['value']) ?? asNumber(modelState['state']);
    if (typeof stateValue === 'number') {
      return stateValue === 4;
    }
  }

  return false;
}

function formatTitle(text: string | undefined, fallback: string): string {
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}

function listWorkspaceRecords(workspaceRoots: string[]): WorkspaceRecord[] {
  const records: WorkspaceRecord[] = [];

  for (const root of workspaceRoots) {
    if (!fs.existsSync(root)) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceDir = path.join(root, entry.name);
      const sessionsDir = path.join(workspaceDir, 'chatSessions');
      if (!fs.existsSync(sessionsDir)) continue;
      try {
        if (!fs.statSync(sessionsDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const meta = readWorkspaceMeta(workspaceDir);
      records.push({
        id: entry.name,
        workspaceDir,
        sessionsDir,
        displayName: getDisplayNameFromMeta(entry.name, meta),
        metaFolderPath: normalizePathLike(meta.folder),
        metaWorkspaceFilePath: normalizePathLike(meta.workspaceFile),
      });
    }
  }

  return records;
}

function getEmptyWindowRoots(globalStorageRoots: string[]): string[] {
  const roots: string[] = [];
  for (const root of globalStorageRoots) {
    const candidate = path.join(root, 'emptyWindowChatSessions');
    if (!fs.existsSync(candidate)) continue;
    try {
      if (!fs.statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    roots.push(candidate);
  }
  return roots;
}

function listSessionFilesById(sessionsDir: string): Map<string, string> {
  const byId = new Map<string, string>();

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return byId;
  }

  for (const fileName of entries) {
    const isJsonl = fileName.endsWith('.jsonl');
    const isJson = fileName.endsWith('.json');
    if (!isJson && !isJsonl) continue;

    const extension = isJsonl ? '.jsonl' : '.json';
    const id = fileName.slice(0, -extension.length);
    const fullPath = path.join(sessionsDir, fileName);

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, fullPath);
      continue;
    }

    if (existing.endsWith('.json') && isJsonl) {
      byId.set(id, fullPath);
    }
  }

  return byId;
}

export async function scanVscodeSessionsFromDisk(
  context: ScanContext
): Promise<Omit<VscodeSessionSummary, 'instanceId'>[]> {
  const workspaceRoots = getDefaultWorkspaceStorageRoots(context.appName);
  const globalStorageRoots = getDefaultGlobalStorageRoots(context.appName);
  const normalizedWorkspaceFile = normalizePathLike(context.workspaceFile ?? undefined);
  const normalizedWorkspaceFolders = new Set(
    (context.workspaceFolders ?? [])
      .map((folder) => normalizePathLike(folder))
      .filter((folder): folder is string => Boolean(folder))
  );
  const shouldFilterByWindow = normalizedWorkspaceFile !== undefined || normalizedWorkspaceFolders.size > 0;
  const includeWorkspaceSessions = shouldFilterByWindow;
  const includeEmptyWindowSessions = !shouldFilterByWindow;

  const sessions: Omit<VscodeSessionSummary, 'instanceId'>[] = [];
  const workspaces = includeWorkspaceSessions ? listWorkspaceRecords(workspaceRoots) : [];
  for (const workspace of workspaces) {
    if (includeWorkspaceSessions) {
      const workspaceFileMatch = normalizedWorkspaceFile
        ? workspace.metaWorkspaceFilePath === normalizedWorkspaceFile
        : false;
      const folderMatch = workspace.metaFolderPath
        ? normalizedWorkspaceFolders.has(workspace.metaFolderPath)
        : false;
      if (!workspaceFileMatch && !folderMatch) {
        continue;
      }
    }

    const filesById = listSessionFilesById(workspace.sessionsDir);
    for (const [id, jsonPath] of filesById.entries()) {
      const parsed = readSessionJson(jsonPath);
      const title = formatTitle(getFirstMessageText(parsed), 'Untitled');
      let lastMessageDate = getLastMessageDate(parsed) ?? 0;
      if (lastMessageDate <= 0) {
        try {
          lastMessageDate = fs.statSync(jsonPath).mtimeMs;
        } catch {
          lastMessageDate = 0;
        }
      }

      sessions.push({
        id,
        title,
        lastMessageDate,
        needsInput: getNeedsInput(parsed) ?? false,
        source: 'workspace',
        workspaceId: workspace.id,
        workspaceDir: workspace.workspaceDir,
        displayName: workspace.displayName,
        jsonPath,
      });
    }
  }

  if (includeEmptyWindowSessions) {
    const emptyRoots = getEmptyWindowRoots(globalStorageRoots);
    for (const root of emptyRoots) {
      const filesById = listSessionFilesById(root);
      for (const [id, jsonPath] of filesById.entries()) {
        const parsed = readSessionJson(jsonPath);
        const title = formatTitle(getFirstMessageText(parsed), '(Empty Window)');
        let lastMessageDate = getLastMessageDate(parsed) ?? 0;
        if (lastMessageDate <= 0) {
          try {
            lastMessageDate = fs.statSync(jsonPath).mtimeMs;
          } catch {
            lastMessageDate = 0;
          }
        }

        sessions.push({
          id,
          title,
          lastMessageDate,
          needsInput: getNeedsInput(parsed) ?? false,
          source: 'empty-window',
          jsonPath,
        });
      }
    }
  }

  const dedupedByFile = new Map<string, Omit<VscodeSessionSummary, 'instanceId'>>();
  for (const session of sessions) {
    const key = `${session.id}::${normalizePathLike(session.jsonPath) ?? session.jsonPath}`;
    const existing = dedupedByFile.get(key);
    if (!existing) {
      dedupedByFile.set(key, session);
      continue;
    }
    dedupedByFile.set(key, {
      ...existing,
      ...session,
      title: session.title || existing.title,
      lastMessageDate: Math.max(existing.lastMessageDate ?? 0, session.lastMessageDate ?? 0),
      needsInput: existing.needsInput || session.needsInput,
      workspaceId: session.workspaceId ?? existing.workspaceId,
      workspaceDir: session.workspaceDir ?? existing.workspaceDir,
      displayName: session.displayName ?? existing.displayName,
    });
  }

  const deduped = Array.from(dedupedByFile.values());
  deduped.sort((a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0));
  return deduped;
}
