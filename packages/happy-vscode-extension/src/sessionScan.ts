import fs from 'fs';
import path from 'path';

import { getDefaultGlobalStorageRoots, getDefaultWorkspaceStorageRoots } from './paths';
import { getDisplayNameFromMeta, readWorkspaceMeta } from './workspaceMeta';
import { loadSqlJs, readItemTableValue } from './sqlite';

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

type WorkspaceRecord = {
  id: string;
  root: string;
  workspaceDir: string;
  sessionsDir: string;
  dbPath: string;
  displayName: string;
};

type ChatIndexEntry = {
  sessionId?: string;
  title?: string;
  lastMessageDate?: number;
  needsInput?: boolean;
};

type ChatIndex = {
  version?: number;
  entries?: Record<string, ChatIndexEntry>;
};

function safeReadJson(filePath: string): unknown | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
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

function getFirstMessageText(json: unknown): string | undefined {
  const rec = asRecord(json);
  if (!rec) return undefined;

  const requests = Array.isArray(rec['requests']) ? rec['requests'] : [];
  const first = requests[0];
  const firstRec = asRecord(first);
  if (!firstRec) return undefined;

  const msg = asRecord(firstRec['message'] ?? firstRec);
  if (!msg) return undefined;

  const direct = asString(msg['text']) ?? asString(msg['content']);
  if (direct) return direct;

  const parts = Array.isArray(msg['parts']) ? msg['parts'] : [];
  for (const p of parts) {
    const pr = asRecord(p);
    const t = pr ? asString(pr['text']) : undefined;
    if (t) return t;
  }

  return undefined;
}

function formatTitle(text: string | undefined, fallback: string): string {
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
}

function readChatIndex(SQL: Awaited<ReturnType<typeof loadSqlJs>>, dbPath: string): ChatIndex | undefined {
  try {
    const value = readItemTableValue(SQL, dbPath, 'chat.ChatSessionStore.index');
    if (!value) return undefined;
    const parsed = JSON.parse(value) as ChatIndex;
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (!parsed.entries || typeof parsed.entries !== 'object') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function listWorkspaceRecords(roots: string[]): WorkspaceRecord[] {
  const results: WorkspaceRecord[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    let entries: fs.Dirent[];
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
      const displayName = getDisplayNameFromMeta(entry.name, meta);

      results.push({
        id: entry.name,
        root,
        workspaceDir,
        sessionsDir,
        dbPath: path.join(workspaceDir, 'state.vscdb'),
        displayName
      });
    }
  }

  return results;
}

function getEmptyWindowRoots(globalStorageRoots: string[]): string[] {
  const results: string[] = [];
  for (const root of globalStorageRoots) {
    const dir = path.join(root, 'emptyWindowChatSessions');
    if (!fs.existsSync(dir)) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    results.push(dir);
  }
  return results;
}

export async function scanVscodeSessions(options?: {
  workspaceRoots?: string[];
  globalStorageRoots?: string[];
}): Promise<VscodeSessionSummary[]> {
  const workspaceRoots = options?.workspaceRoots ?? getDefaultWorkspaceStorageRoots();
  const globalStorageRoots = options?.globalStorageRoots ?? getDefaultGlobalStorageRoots();

  const SQL = await loadSqlJs();
  const results: VscodeSessionSummary[] = [];

  const workspaces = listWorkspaceRecords(workspaceRoots);
  for (const ws of workspaces) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(ws.sessionsDir);
    } catch {
      continue;
    }

    const index = readChatIndex(SQL, ws.dbPath);
    const indexEntries = index?.entries ?? {};

    for (const fileName of entries) {
      if (!fileName.endsWith('.json')) continue;
      const id = path.basename(fileName, '.json');
      const jsonPath = path.join(ws.sessionsDir, fileName);
      const entry = indexEntries[id];

      let title = entry?.title;
      let lastMessageDate = entry?.lastMessageDate;
      let needsInput = Boolean(entry?.needsInput);

      if (!title || !lastMessageDate) {
        const json = safeReadJson(jsonPath);
        if (json) {
          if (!title) {
            title = formatTitle(getFirstMessageText(json), 'Untitled');
          }
          if (!lastMessageDate) {
            const rec = asRecord(json);
            lastMessageDate = asNumber(rec?.['lastMessageDate']);
          }
        }
      }

      if (!lastMessageDate) {
        try {
          lastMessageDate = fs.statSync(jsonPath).mtimeMs;
        } catch {
          lastMessageDate = 0;
        }
      }

      results.push({
        id,
        title: title ?? 'Untitled',
        lastMessageDate,
        needsInput,
        source: 'workspace',
        workspaceId: ws.id,
        workspaceDir: ws.workspaceDir,
        displayName: ws.displayName,
        jsonPath
      });
    }
  }

  const emptyRoots = getEmptyWindowRoots(globalStorageRoots);
  for (const dir of emptyRoots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const fileName of entries) {
      if (!fileName.endsWith('.json')) continue;
      const id = path.basename(fileName, '.json');
      const jsonPath = path.join(dir, fileName);
      const json = safeReadJson(jsonPath);
      const title = json ? formatTitle(getFirstMessageText(json), '(Empty Window)') : '(Empty Window)';
      const lastMessageDate = json ? asNumber(asRecord(json)?.['lastMessageDate']) : undefined;

      results.push({
        id,
        title,
        lastMessageDate: lastMessageDate ?? 0,
        needsInput: false,
        source: 'empty-window',
        jsonPath
      });
    }
  }

  results.sort((a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0));
  return results;
}
