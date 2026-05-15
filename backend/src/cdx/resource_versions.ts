import { getPathParts } from '../http/url';
import { CdxRepository } from './repository';

const PAGE_SIZE = 100;

export function getListVersionsData(
  cdxRepo: CdxRepository,
  url: string,
  cursor: number | null,
) {
  const versions = cdxRepo.findResourceVersionsPage(
    url,
    cursor ?? 0,
    PAGE_SIZE,
  );

  const nextCursor =
    versions.length === PAGE_SIZE
      ? versions[versions.length - 1].timestamp
      : null;

  const parts = getPathParts(url);
  const breadcrumbs = parts.map((_, i) => ({
    label: parts[i],
    path: parts.slice(0, i + 1).join(''),
    level: i,
  }));

  return { url, versions, nextCursor, breadcrumbs };
}
