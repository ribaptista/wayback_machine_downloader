import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dbPath = process.env.DB_PATH ?? './wayback.db';
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

migrate(drizzle(sqlite), {
  migrationsFolder: path.join(__dirname, 'db', 'migrations'),
});

console.log(`Migrations applied to ${dbPath}`);
sqlite.close();
