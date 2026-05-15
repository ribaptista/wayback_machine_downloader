import type { Eta } from 'eta';
import { SearchRepository } from './repository';

export function getSearchesData(searchRepo: SearchRepository) {
  const repo = searchRepo;
  const rows = repo.findSummaries();

  const searches = rows.map((row) => ({
    ...row,
    conditions: repo.findConditionSummariesBySearchId(row.id),
    domains: repo.findDomainSummariesBySearchId(row.id).map((r) => r.domain),
  }));

  const hasRunning = searches.some(
    (s) => s.status === 'pending' || s.status === 'running',
  );

  return { searches, hasRunning };
}

export function deleteSearch(
  searchRepo: SearchRepository,
  searchId: number,
): void {
  searchRepo.deleteSearch(searchId);
}
