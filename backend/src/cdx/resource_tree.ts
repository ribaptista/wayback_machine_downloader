import { getPathParts } from '../http/url';
import { CdxRepository } from './repository';

const PAGE_SIZE = 100;

export function getResourcesData(
  cdxRepo: CdxRepository,
  filterPath: string | null,
  filterLevel: number,
  cursor: string | null,
) {
  const nodes = cdxRepo.findTreeNodesPage(
    filterPath,
    filterLevel,
    cursor ?? '',
    PAGE_SIZE,
  );

  const nextCursor =
    nodes.length === PAGE_SIZE ? nodes[nodes.length - 1].path : null;

  let breadcrumbs: { label: string; path: string; level: number }[] = [];
  if (filterPath !== null) {
    const parts = getPathParts(filterPath);
    breadcrumbs = parts.map((_, i) => ({
      label: parts[i],
      path: parts.slice(0, i + 1).join(''),
      level: i,
    }));
  }

  return { nodes, nextCursor, path: filterPath, breadcrumbs };
}
