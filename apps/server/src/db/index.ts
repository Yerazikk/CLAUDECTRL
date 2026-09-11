import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './schema';

let db: BetterSqlite3.Database | null = null;

export function getDb(): BetterSqlite3.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDb(dataDir: string): BetterSqlite3.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'claudectrl.db');
  db = new BetterSqlite3(dbPath);
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
