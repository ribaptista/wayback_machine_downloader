import { RunRepository } from './repository';
import type { RunArgRow } from './repository';

export interface RunStats {
  id: string;
  created_at: string;
  args: RunArgRow[];
  new_entry_count: number;
  requested_total: number;
  requested_by_domain: { domain: string; count: number }[];
  downloaded_total: number;
  downloaded_by_domain: { domain: string; count: number }[];
  errors_total: number;
  errors_by_domain: { domain: string; count: number }[];
  errors_by_type: {
    domain_name: string;
    error_name: string;
    error_code: string;
    count: number;
  }[];
}

export function getRunsData(runRepo: RunRepository): RunStats[] {
  const repo = runRepo;
  const runs = repo.findAll();

  return runs.map((run) => {
    const domainStats = repo.findDomainStatsByRunId(run.id);
    return {
      id: run.id,
      created_at: run.created_at,
      args: repo.findArgsByRunId(run.id),
      new_entry_count: run.new_entry_count,
      requested_total: run.entry_total_count,
      requested_by_domain: domainStats.map((r) => ({
        domain: r.domain_name,
        count: r.attempted_entry_count,
      })),
      downloaded_total: run.successful_entry_count,
      downloaded_by_domain: domainStats.map((r) => ({
        domain: r.domain_name,
        count: r.successful_entry_count,
      })),
      errors_total: run.errored_entry_count,
      errors_by_domain: domainStats.map((r) => ({
        domain: r.domain_name,
        count: r.errored_entry_count,
      })),
      errors_by_type: repo.findErrorTypeStatsByRunId(run.id),
    };
  });
}
