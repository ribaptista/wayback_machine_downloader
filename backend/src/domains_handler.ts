import type { Database as DB } from 'better-sqlite3';

export interface DomainStats {
  id: string;
  domain: string;
  resources: number;
  downloaded: number;
  errored: number;
  pending: number;
}

export function getDomainsStats(db: DB): DomainStats[] {
  return db
    .prepare<[], DomainStats>(
      `SELECT
         cf.id,
         cf.domain,
         COUNT(rv.url) AS resources,
         SUM(rv.successful_request_id IS NOT NULL) AS downloaded,
         SUM(rv.successful_request_id IS NULL AND EXISTS (
           SELECT 1 FROM request r
           INNER JOIN request_errors re ON re.request_id = r.id
           WHERE r.resource_version_url = rv.url
             AND r.resource_version_timestamp = rv.timestamp
         )) AS errored,
         SUM(rv.url IS NOT NULL AND rv.successful_request_id IS NULL AND NOT EXISTS (
           SELECT 1 FROM request r
           INNER JOIN request_errors re ON re.request_id = r.id
           WHERE r.resource_version_url = rv.url
             AND r.resource_version_timestamp = rv.timestamp
         )) AS pending
       FROM cdx_file cf
       LEFT JOIN resource_version_source rvs ON rvs.cdx_id = cf.id
       LEFT JOIN resource_version rv ON rv.url = rvs.url AND rv.timestamp = rvs.timestamp
       GROUP BY cf.id, cf.domain
       ORDER BY cf.domain`,
    )
    .all();
}
