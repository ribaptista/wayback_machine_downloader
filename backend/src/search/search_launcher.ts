import path from 'path';
import { Worker } from 'worker_threads';
import type { SearchCondition } from './file_search_worker/file_search';
import { PAGE_SIZE } from './search_worker/search_scan';
import type {
  SearchScanRequest,
  SearchScanResponse,
} from './search_worker/search_scan';
import { SearchRepository } from './repository';
import { CdxRepository } from '../cdx/repository';

export interface SearchConditionInput {
  regex: RegExp;
  notRegexNearby?: RegExp;
}

export interface RunSearchOptions {
  dbPath: string;
  baseFolder: string;
  maxWorkers: number;
  contextSize: number;
  cdxFileIds: string[];
}

export async function runSearch(
  conditionInputs: SearchConditionInput[],
  searchRepo: SearchRepository,
  cdxRepo: CdxRepository,
  opts: RunSearchOptions,
): Promise<number> {
  const {
    dbPath,
    baseFolder,
    maxWorkers,
    contextSize,
    cdxFileIds: filterIds,
  } = opts;

  const cdxNames =
    filterIds.length > 0
      ? cdxRepo.findDomainNamesIn(filterIds)
      : cdxRepo.findAllDomains().map((r) => r.name);
  const cdxFileIds = filterIds.length > 0 ? cdxNames : [];

  const total = cdxRepo.countHtmlCandidates(cdxFileIds);

  const searchId = searchRepo.insertSearch(total);
  searchRepo.insertDomains(searchId, cdxFileIds);

  const conditions: SearchCondition[] = [];
  for (const input of conditionInputs) {
    const notRegex = input.notRegexNearby?.source ?? null;
    const id = searchRepo.insertCondition(
      searchId,
      input.regex.source,
      notRegex,
      contextSize,
    );
    conditions.push({
      id,
      regex: input.regex,
      notRegexNearby: input.notRegexNearby ?? null,
      contextSize,
    });
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(
    `[search ${searchId}] Found ${total} HTML candidates (${totalPages} pages)`,
  );

  const scanRequest: SearchScanRequest = {
    dbPath,
    searchId,
    baseFolder,
    maxWorkers,
    cdxFileIds,
    conditions,
    totalPages,
  };

  const workerPromise = new Promise<SearchScanResponse>((resolve, reject) => {
    const worker = new Worker(
      path.join(__dirname, 'search_worker', 'search_scan.ts'),
      {
        execArgv: [...process.execArgv],
      },
    );
    worker.once('message', (msg: SearchScanResponse) => resolve(msg));
    worker.once('error', reject);
    worker.postMessage(scanRequest);
  });

  workerPromise
    .then((response) => {
      if ('error' in response) {
        searchRepo.setSearchError(response.error, searchId);
      } else {
        searchRepo.setSearchStatus('done', searchId);
      }
    })
    .catch((err: unknown) => {
      searchRepo.setSearchError(String(err), searchId);
    });

  console.log(`[search ${searchId}] Scan started in background`);
  return searchId;
}
