import fs from 'fs';
import path from 'path';

export type WorkspaceMeta = {
  folder?: string;
  workspaceFile?: string;
};

function safeReadJsonFile(filePath: string): unknown | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function readWorkspaceMeta(workspaceDir: string): WorkspaceMeta {
  const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');
  if (!fs.existsSync(workspaceJsonPath)) return {};

  const json = safeReadJsonFile(workspaceJsonPath);
  if (!json || typeof json !== 'object') return {};

  const obj = json as Record<string, unknown>;
  const meta: WorkspaceMeta = {};

  const folder = obj['folder'];
  if (typeof folder === 'string') {
    meta.folder = folder;
  } else if (folder && typeof folder === 'object') {
    const folderObj = folder as Record<string, unknown>;
    if (typeof folderObj['path'] === 'string') meta.folder = folderObj['path'];
  }

  const workspaceFile = obj['workspace'];
  if (typeof workspaceFile === 'string') {
    meta.workspaceFile = workspaceFile;
  }

  return meta;
}

export function getDisplayNameFromMeta(workspaceId: string, meta: WorkspaceMeta): string {
  const short = workspaceId.slice(0, 8);

  const fromPath = (p: string | undefined): string | undefined => {
    if (!p) return undefined;
    try {
      const cleaned = p.startsWith('file://') ? p.slice('file://'.length) : p;
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
