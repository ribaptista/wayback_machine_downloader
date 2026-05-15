import { CdxRepository } from './repository';
import type { DomainStatsRow } from './repository';

export type DomainStats = DomainStatsRow;

export function getDomainsStats(cdxRepo: CdxRepository): DomainStats[] {
  return cdxRepo.findDomainsStats();
}
