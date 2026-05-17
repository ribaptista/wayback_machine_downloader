import { buildAssetPath } from '../request/paths';
import fs from 'fs';
import { SearchFileRow, SearchRepository } from './repository';
import { ReactionRepository } from '../reaction/repository';
import { RequestRepository } from '../request/repository';
import { CdxRepository } from '../cdx/repository';
import { ContextWindow, mergeContextWindows } from './match_rendering';
import { withTimingLog } from '../observability/timing';

const RESULTS_PAGE_SIZE = 10;
const CONTEXT_LENGTH = 256;

function buildContextWindows(
  file: SearchFileRow,
  activeConditionIds: number[] | null,
  baseFolder: string,
  searchRepo: SearchRepository,
): ContextWindow[] {
  const rawMatches = searchRepo.findMatchesByFileId(
    file.id,
    activeConditionIds,
  );
  if (!file.body_digest) {
    throw new Error(`Missing body_digest for request_id=${file.request_id}`);
  }
  const filePath = buildAssetPath(baseFolder, file.body_digest) + '.text';
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return mergeContextWindows(fileContent, rawMatches, CONTEXT_LENGTH);
}

type ExpandedSearchFile = SearchFileRow &
  ({ fileError: string } | { contextWindows: ContextWindow[] });

function enrichSearchFile(
  file: SearchFileRow,
  searchId: number,
  activeConditionIds: number[] | null,
  baseFolder: string,
  searchRepo: SearchRepository,
): ExpandedSearchFile {
  try {
    const contextWindows = buildContextWindows(
      file,
      activeConditionIds,
      baseFolder,
      searchRepo,
    );
    return { ...file, contextWindows };
  } catch (err) {
    const fileError = (err as Error).message;
    console.error(`[search ${searchId}] ${fileError}`);
    return { ...file, fileError };
  }
}

function buildSimilarGroupReactions(
  filesWithData: ExpandedSearchFile[],
  searchId: number,
  searchRepo: SearchRepository,
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  const digestsWithDupes = filesWithData
    .filter((f) => f.duplicate_count > 1)
    .map((f) => f.context_digest);
  if (digestsWithDupes.length === 0) return result;
  const rows = searchRepo.findSimilarGroupReactions(digestsWithDupes, searchId);
  for (const row of rows) {
    (result[row.context_digest] ??= []).push(row.reaction_type_id);
  }
  return result;
}

const t = withTimingLog('search_results');

export function getSearchResultsData(
  searchId: number,
  cursorTimestamp: number | undefined,
  cursorRequestId: string | undefined,
  searchRepo: SearchRepository,
  reactionRepo: ReactionRepository,
  cdxRepo: CdxRepository,
  reqRepo: RequestRepository,
  baseFolder: string,
  similarTo?: string,
  filterDomains?: string[],
  filterConditionIds?: number[],
  filterReactionTypeIds?: number[],
) {
  const search = t('search', () => searchRepo.findById(searchId));

  if (!search) {
    return null;
  }

  const conditions = t('conditions', () =>
    searchRepo.findConditionsBySearchId(searchId),
  );

  const domains = t('searchScopeDomains', () =>
    searchRepo.findDomainsBySearchId(searchId),
  );

  const activeDomainIds = filterDomains?.length ? filterDomains : null;
  const activeConditionIds = filterConditionIds?.length
    ? filterConditionIds
    : null;
  const activeReactionTypeIds = filterReactionTypeIds?.length
    ? filterReactionTypeIds
    : null;

  const hasCursor =
    cursorTimestamp !== undefined && cursorRequestId !== undefined;

  const fileFilter = {
    searchId,
    domainFilter: activeDomainIds ?? undefined,
    conditionFilter: activeConditionIds ?? undefined,
    reactionFilter: activeReactionTypeIds ?? undefined,
    cursor: hasCursor
      ? { timestamp: cursorTimestamp!, requestId: cursorRequestId! }
      : undefined,
  };

  const totalFiles = t('totalFiles', () =>
    similarTo
      ? searchRepo.countResultsWithContextDigest(
          searchId,
          similarTo,
          fileFilter,
        )
      : searchRepo.countResultFiles(fileFilter),
  );

  const files = t('files', () =>
    similarTo
      ? searchRepo.findResultsWithContextDigestPage(
          searchId,
          similarTo,
          fileFilter,
        )
      : searchRepo.findResultFilesPage(fileFilter),
  );

  const filesWithData = t('filesWithData', () =>
    files.map((file) =>
      enrichSearchFile(
        file,
        searchId,
        activeConditionIds,
        baseFolder,
        searchRepo,
      ),
    ),
  );

  const reactionTypes = t('reactionTypes', () => reactionRepo.findAllTypes());

  // Active reactions for this page's exact url+timestamp entries
  const activeReactions: Set<string> =
    filesWithData.length > 0
      ? new Set(
          t('activeReactions', () =>
            reactionRepo.findActiveForPages(filesWithData),
          ),
        )
      : new Set();

  // For non-similarTo view: for files that are non-duplicate representatives,
  // check if any item in their context_digest group has a reaction
  const similarGroupReactions =
    !similarTo && !activeReactionTypeIds && filesWithData.length > 0
      ? t('similarGroupReactions', () =>
          buildSimilarGroupReactions(filesWithData, searchId, searchRepo),
        )
      : {};

  const facetParams = {
    searchId,
    domainFilter: activeDomainIds ?? undefined,
    conditionFilter: activeConditionIds ?? undefined,
    reactionFilter: activeReactionTypeIds ?? undefined,
  };

  const countsByDomain = similarTo
    ? {}
    : Object.fromEntries(
        t('countsByDomain', () => searchRepo.countByDomain(facetParams)).map(
          (row) => [row.domain_name, row.count],
        ),
      );

  const countsByCondition = similarTo
    ? {}
    : t('countsByCondition', () => searchRepo.countByCondition(facetParams));

  const countsByReaction = similarTo
    ? {}
    : t('countsByReaction', () =>
        searchRepo.countByReactionType({
          searchId,
          domainFilter: activeDomainIds ?? undefined,
          conditionFilter: activeConditionIds ?? undefined,
        }),
      );

  const lastFile = files.length > 0 ? files[files.length - 1] : null;
  const nextCursor =
    files.length === RESULTS_PAGE_SIZE && lastFile
      ? {
          timestamp: lastFile.resource_version_timestamp,
          requestId: lastFile.request_id,
        }
      : null;

  return {
    search,
    conditions,
    domains,
    files: filesWithData,
    totalFiles,
    nextCursor,
    searchId,
    similarTo: similarTo ?? null,
    isPending: search.status === 'pending' || search.status === 'running',
    filterDomains: activeDomainIds ?? [],
    filterConditionIds: activeConditionIds ?? [],
    filterReactionTypeIds: activeReactionTypeIds ?? [],
    reactionTypes,
    activeReactions: [...activeReactions],
    similarGroupReactions,
    countsByDomain,
    countsByCondition,
    countsByReaction,
  };
}
