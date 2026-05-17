import {
  ReactionRepository,
  type ReactionDomainRow,
  type ReactionTypeRow,
  type ReactionViewFileRow,
} from './repository';

const PAGE_SIZE = 20;

export interface ReactionsViewData {
  files: ReactionViewFileRow[];
  totalFiles: number;
  totalPages: number;
  currentPage: number;
  reactionTypes: ReactionTypeRow[];
  domains: ReactionDomainRow[];
  activeReactions: string[];
  matchedConditions: Record<
    string,
    { id: number; regex: string; not_regex_nearby: string | null }[]
  >;
}

export function setReaction(
  reactionRepo: ReactionRepository,
  url: string,
  timestamp: number,
  reactionTypeId: number,
  active: boolean,
): { activeReactionTypeIds: number[] } {
  return reactionRepo.setReaction(url, timestamp, reactionTypeId, active);
}

export function getReactionsViewData(
  reactionRepo: ReactionRepository,
  reactionTypeId: number,
  page: number,
  filterDomains?: string[],
): ReactionsViewData {
  const reactionTypes = reactionRepo.findAllTypes();
  const domains = reactionRepo.findDomainsForReactionType(reactionTypeId);

  const activeDomainIds = filterDomains?.length ? filterDomains : null;

  const totalFiles = reactionRepo.countFilesForReactionType(
    reactionTypeId,
    activeDomainIds,
  );
  const totalPages = Math.max(1, Math.ceil(totalFiles / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const files = reactionRepo.findFilesForReactionTypePage(
    reactionTypeId,
    PAGE_SIZE,
    offset,
    activeDomainIds,
  );

  const activeReactions = reactionRepo.findActiveForPages(files);
  const matchedConditions = reactionRepo.findMatchedConditionsForFiles(files);

  return {
    files,
    totalFiles,
    totalPages,
    currentPage: safePage,
    reactionTypes,
    domains,
    activeReactions,
    matchedConditions,
  };
}
