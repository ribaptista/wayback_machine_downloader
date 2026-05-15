import { CdxRepository } from './repository';

const PAGE_SIZE = 100;

type FilterOption = {
  error_code: string;
  error_name: string;
};

export function getDomainErrorFilters(
  cdxRepo: CdxRepository,
  domain: string,
): FilterOption[] {
  return cdxRepo.findErrorFilters(domain);
}

export type ErrorEntry = {
  url: string;
  timestamp: number;
  errors: {
    error_code: string;
    error_name: string;
    error_message: string;
  }[];
};

export function getDomainErrorsData(
  cdxRepo: CdxRepository,
  domain: string,
  filterCodes: string[],
  filterNames: string[],
  cursorUrl: string | null,
  cursorTs: number | null,
) {
  const repo = cdxRepo;

  const versions = repo.findErrorVersionsPage({
    domainName: domain,
    filterCodes,
    filterNames,
    cursorUrl,
    cursorTs,
    pageSize: PAGE_SIZE,
  });

  if (versions.length === 0) {
    return { domain, entries: [], nextCursor: null };
  }

  const requestIds = versions.map((v) => v.last_errored_request_id);
  const errorRows = repo.findErrorsByRequestIds(requestIds);

  const errorsByRequestId = new Map<string, typeof errorRows>();
  for (const re of errorRows) {
    const arr = errorsByRequestId.get(re.request_id) ?? [];
    arr.push(re);
    errorsByRequestId.set(re.request_id, arr);
  }

  const entries: ErrorEntry[] = versions.map((v) => ({
    url: v.url,
    timestamp: v.timestamp,
    errors: (errorsByRequestId.get(v.last_errored_request_id) ?? []).map(
      (re) => ({
        error_code: re.error_code,
        error_name: re.error_name,
        error_message: re.error_message,
      }),
    ),
  }));

  const lastVersion = versions[versions.length - 1];
  const nextCursor =
    versions.length === PAGE_SIZE
      ? { url: lastVersion.url, timestamp: lastVersion.timestamp }
      : null;

  return { domain, entries, nextCursor };
}
