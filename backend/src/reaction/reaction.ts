import { ReactionRepository } from './repository';

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
) {
  return reactionRepo.getViewPage({
    reactionTypeId,
    page,
    filterDomains,
  });
}
