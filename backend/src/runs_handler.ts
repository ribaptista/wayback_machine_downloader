import type { Database as DB } from 'better-sqlite3';

interface RunRow {
  id: string;
  created_at: string;
}

interface RunArgRow {
  arg_name: string;
  arg_value: string;
}

interface DownloadedByDomainRow {
  domain: string;
  count: number;
}

interface ErrorByDomainRow {
  domain: string;
  count: number;
}

interface ErrorByTypeRow {
  error_name: string | null;
  error_code: string;
  count: number;
}

export interface RunStats {
  id: string;
  created_at: string;
  args: RunArgRow[];
  new_cdx_entry_count: number;
  requested_total: number;
  requested_by_domain: DownloadedByDomainRow[];
  downloaded_total: number;
  downloaded_by_domain: DownloadedByDomainRow[];
  errors_total: number;
  errors_by_domain: ErrorByDomainRow[];
  errors_by_type: ErrorByTypeRow[];
}

export function getRunsData(db: DB): RunStats[] {
  const runs = db
    .prepare<
      [],
      RunRow
    >(`SELECT id, created_at FROM run ORDER BY created_at DESC`)
    .all();

  const argStmt = db.prepare<[string], RunArgRow>(
    `SELECT arg_name, arg_value FROM run_args WHERE run_id = ? ORDER BY id`,
  );

  const cdxCountStmt = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count FROM cdx_entry WHERE run_id = ?`,
  );

  const requestedTotalStmt = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count FROM request WHERE run_id = ?`,
  );

  const requestedByDomainStmt = db.prepare<[string], DownloadedByDomainRow>(
    `SELECT cf.domain, COUNT(*) AS count
     FROM request r
     INNER JOIN resource_version_source rvs
       ON rvs.url = r.resource_version_url AND rvs.timestamp = r.resource_version_timestamp
     INNER JOIN cdx_file cf ON cf.id = rvs.cdx_id
     WHERE r.run_id = ?
     GROUP BY cf.domain
     ORDER BY cf.domain`,
  );

  const downloadedTotalStmt = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count
     FROM resource_version rv
     INNER JOIN request r ON r.id = rv.successful_request_id
     WHERE r.run_id = ?`,
  );

  const downloadedByDomainStmt = db.prepare<[string], DownloadedByDomainRow>(
    `SELECT cf.domain, COUNT(*) AS count
     FROM resource_version rv
     INNER JOIN request r ON r.id = rv.successful_request_id
     INNER JOIN resource_version_source rvs
       ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
     INNER JOIN cdx_file cf ON cf.id = rvs.cdx_id
     WHERE r.run_id = ?
     GROUP BY cf.domain
     ORDER BY cf.domain`,
  );

  const errorsTotalStmt = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count
     FROM request_errors re
     INNER JOIN request r ON r.id = re.request_id
     WHERE r.run_id = ?`,
  );

  const errorsByDomainStmt = db.prepare<[string], ErrorByDomainRow>(
    `SELECT cf.domain, COUNT(*) AS count
     FROM request_errors re
     INNER JOIN request r ON r.id = re.request_id
     INNER JOIN resource_version_source rvs
       ON rvs.url = r.resource_version_url AND rvs.timestamp = r.resource_version_timestamp
     INNER JOIN cdx_file cf ON cf.id = rvs.cdx_id
     WHERE r.run_id = ?
     GROUP BY cf.domain
     ORDER BY cf.domain`,
  );

  const errorsByTypeStmt = db.prepare<[string], ErrorByTypeRow>(
    `SELECT re.error_name, re.error_code, COUNT(*) AS count
     FROM request_errors re
     INNER JOIN request r ON r.id = re.request_id
     WHERE r.run_id = ?
     GROUP BY re.error_name, re.error_code
     ORDER BY count DESC`,
  );

  return runs.map((run) => ({
    id: run.id,
    created_at: run.created_at,
    args: argStmt.all(run.id),
    new_cdx_entry_count: cdxCountStmt.get(run.id)?.count ?? 0,
    requested_total: requestedTotalStmt.get(run.id)?.count ?? 0,
    requested_by_domain: requestedByDomainStmt.all(run.id),
    downloaded_total: downloadedTotalStmt.get(run.id)?.count ?? 0,
    downloaded_by_domain: downloadedByDomainStmt.all(run.id),
    errors_total: errorsTotalStmt.get(run.id)?.count ?? 0,
    errors_by_domain: errorsByDomainStmt.all(run.id),
    errors_by_type: errorsByTypeStmt.all(run.id),
  }));
}
