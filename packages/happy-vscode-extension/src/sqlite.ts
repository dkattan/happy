import fs from 'fs';
import path from 'path';

import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';

let SQLPromise: Promise<SqlJsStatic> | null = null;

export async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!SQLPromise) {
    const wasmPath: string = require.resolve('sql.js/dist/sql-wasm.wasm');
    const wasmDir = path.dirname(wasmPath);
    SQLPromise = initSqlJs({
      locateFile: (file: string) => path.join(wasmDir, file)
    });
  }
  return SQLPromise;
}

export function readItemTableValue(SQL: SqlJsStatic, dbPath: string, key: string): string | undefined {
  if (!fs.existsSync(dbPath)) return undefined;

  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(new Uint8Array(fileBuffer));
  try {
    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
    try {
      stmt.bind([key]);
      if (!stmt.step()) return undefined;
      const row = stmt.getAsObject() as { value?: unknown };
      return typeof row.value === 'string' ? row.value : undefined;
    } finally {
      stmt.free();
    }
  } finally {
    db.close();
  }
}
