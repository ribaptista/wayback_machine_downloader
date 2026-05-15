import type { Database as DB } from 'better-sqlite3';

export interface RunRow {
  id: string;
  created_at: string;
  new_entry_count: number;
  entry_total_count: number;
  successful_entry_count: number;
  errored_entry_count: number;
}

export interface RunArgRow {
  arg_name: string;
  arg_value: string;
}

export interface RunDomainStatsRow {
  domain_name: string;
  attempted_entry_count: number;
  successful_entry_count: number;
  errored_entry_count: number;
}

export interface RunErrorTypeStatsRow {
  domain_name: string;
  error_name: string;
  error_code: string;
  count: number;
}

export class RunRepository {
  constructor(private readonly db: DB) {}

  insertRun(runId: string): void {
    this.db.prepare(`INSERT INTO run (id) VALUES (?)`).run(runId);
  }

  insertRunArgs(runId: string, args: object): void {
    const stmt = this.db.prepare(
      `INSERT INTO run_args (run_id, arg_name, arg_value) VALUES (?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const [name, value] of Object.entries(args)) {
        if (value === undefined) continue;
        const values = Array.isArray(value) ? value : [String(value)];
        for (const v of values) {
          stmt.run(runId, name, v);
        }
      }
    })();
  }

  findAll(): RunRow[] {
    return this.db
      .prepare<[], RunRow>(
        `SELECT id, created_at, new_entry_count, entry_total_count,
                successful_entry_count, errored_entry_count
         FROM run ORDER BY created_at DESC`,
      )
      .all();
  }

  findArgsByRunId(runId: string): RunArgRow[] {
    return this.db
      .prepare<
        [string],
        RunArgRow
      >(`SELECT arg_name, arg_value FROM run_args WHERE run_id = ? ORDER BY id`)
      .all(runId);
  }

  findDomainStatsByRunId(runId: string): RunDomainStatsRow[] {
    return this.db
      .prepare<[string], RunDomainStatsRow>(
        `SELECT rds.domain_name, rds.attempted_entry_count,
                rds.successful_entry_count, rds.errored_entry_count
         FROM run_domain_stats rds
         WHERE rds.run_id = ?
         ORDER BY rds.domain_name`,
      )
      .all(runId);
  }

  findErrorTypeStatsByRunId(runId: string): RunErrorTypeStatsRow[] {
    return this.db
      .prepare<[string], RunErrorTypeStatsRow>(
        `SELECT rets.domain_name, rets.error_name, rets.error_code, rets.count
         FROM run_error_type_stats rets
         WHERE rets.run_id = ?
         ORDER BY rets.domain_name, rets.count DESC`,
      )
      .all(runId);
  }

  /** Increments entry_total_count by 1, plus optional successful/errored counters. */
  incrementStats(
    successIncrement: number,
    errorIncrement: number,
    runId: string,
  ): void {
    this.db
      .prepare(
        `UPDATE run SET
           entry_total_count = entry_total_count + 1,
           successful_entry_count = successful_entry_count + ?,
           errored_entry_count = errored_entry_count + ?
         WHERE id = ?`,
      )
      .run(successIncrement, errorIncrement, runId);
  }

  incrementNewEntryCount(runId: string): void {
    this.db
      .prepare(
        `UPDATE run SET new_entry_count = new_entry_count + 1 WHERE id = ?`,
      )
      .run(runId);
  }

  upsertDomainStats(
    runId: string,
    domainName: string,
    successCount: number,
    errorCount: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO run_domain_stats
           (run_id, domain_name, attempted_entry_count, successful_entry_count, errored_entry_count)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (run_id, domain_name) DO UPDATE SET
           attempted_entry_count  = attempted_entry_count  + 1,
           successful_entry_count = successful_entry_count + excluded.successful_entry_count,
           errored_entry_count    = errored_entry_count    + excluded.errored_entry_count`,
      )
      .run(runId, domainName, successCount, errorCount);
  }

  upsertErrorTypeStats(
    runId: string,
    domainName: string,
    errorName: string,
    errorCode: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO run_error_type_stats (run_id, domain_name, error_name, error_code, count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT (run_id, domain_name, error_name, error_code) DO UPDATE SET count = count + 1`,
      )
      .run(runId, domainName, errorName, errorCode);
  }
}
