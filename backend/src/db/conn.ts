import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

// NULL-safe equality operator for use in prepared statement WHERE clauses.
// SQLite:    `col IS ?`                   — works for both NULL and non-NULL values.
// PostgreSQL: `col IS NOT DISTINCT FROM $n` — replace if switching databases;
//             plain `col = $n` does NOT match NULL = NULL in postgres.
export const SQL_NULL_SAFE_EQ = 'IS';

export function openDatabase(filePath: string): DB {
  const sqlite = new Database(filePath, {
    // verbose: console.log,
  });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return sqlite;
}

export type { DB };
