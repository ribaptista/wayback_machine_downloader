import type { Database as DB } from 'better-sqlite3';

const PAGE_SIZE = 20;

interface ReactionTypeRow {
  id: number;
  label: string;
  emoji: string;
}

interface DomainRow {
  id: string;
  domain: string;
}

interface ReactionViewFileRow {
  body_digest: string;
  request_id: string;
  original: string;
  timestamp: string;
}

interface MatchedConditionRow {
  body_digest: string;
  condition_id: number;
  regex: string;
  not_regex_nearby: string | null;
}

export function getReactionsViewData(
  db: DB,
  reactionTypeId: number,
  page: number,
  filterDomains?: string[],
) {
  const reactionTypes = db
    .prepare<
      [],
      ReactionTypeRow
    >(`SELECT id, label, emoji FROM reaction_type ORDER BY id`)
    .all();

  // Domains present in the reacted resources (same base query + rvs join)
  const domains = db
    .prepare<[number], DomainRow>(
      `SELECT DISTINCT cf.id, cf.domain
       FROM reaction rx
       INNER JOIN request r
         ON r.body_digest = rx.body_digest
        AND r.is_successful = 1
       INNER JOIN resource_version_source rvs
         ON rvs.url = r.resource_version_url
        AND rvs.timestamp = r.resource_version_timestamp
       INNER JOIN cdx_file cf ON cf.id = rvs.cdx_id
       WHERE rx.reaction_type_id = ?
       ORDER BY cf.domain`,
    )
    .all(reactionTypeId);

  const activeDomainIds = filterDomains?.length ? filterDomains : null;
  const domainWhere = activeDomainIds
    ? `AND rvs_filter.cdx_id IN (${activeDomainIds.map(() => '?').join(',')})`
    : '';
  const domainJoin = activeDomainIds
    ? `INNER JOIN resource_version_source rvs_filter
         ON rvs_filter.url = r.resource_version_url
        AND rvs_filter.timestamp = r.resource_version_timestamp`
    : '';
  const domainParams: string[] = activeDomainIds ?? [];

  const totalFiles =
    db
      .prepare<unknown[], { count: number }>(
        `SELECT COUNT(DISTINCT rx.body_digest) AS count
         FROM reaction rx
         INNER JOIN request r
           ON r.body_digest = rx.body_digest
          AND r.is_successful = 1
         ${domainJoin}
         WHERE rx.reaction_type_id = ?
         ${domainWhere}`,
      )
      .get(reactionTypeId, ...domainParams)?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(totalFiles / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  // One representative request per body_digest, most recent first
  const files = db
    .prepare<unknown[], ReactionViewFileRow>(
      `SELECT rx.body_digest,
              r.id AS request_id,
              r.resource_version_url AS original,
              CAST(r.resource_version_timestamp AS TEXT) AS timestamp
       FROM reaction rx
       INNER JOIN request r
         ON r.body_digest = rx.body_digest
        AND r.is_successful = 1
       ${domainJoin}
       WHERE rx.reaction_type_id = ?
       ${domainWhere}
       GROUP BY rx.body_digest
       ORDER BY MAX(r.resource_version_timestamp) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(reactionTypeId, ...domainParams, PAGE_SIZE, offset);

  const bodyDigests = files.map((f) => f.body_digest).filter(Boolean);
  const activeReactions: string[] =
    bodyDigests.length > 0
      ? db
          .prepare<
            unknown[],
            { reaction_type_id: number; body_digest: string }
          >(
            `SELECT reaction_type_id, body_digest
             FROM reaction
             WHERE body_digest IN (${bodyDigests.map(() => '?').join(',')})`,
          )
          .all(...bodyDigests)
          .map((r) => `${r.body_digest}:${r.reaction_type_id}`)
      : [];

  // For each result on this page, find all search conditions that matched it
  const matchedConditionsRaw: MatchedConditionRow[] =
    bodyDigests.length > 0
      ? db
          .prepare<unknown[], MatchedConditionRow>(
            `SELECT DISTINCT r.body_digest, sc.id AS condition_id, sc.regex, sc.not_regex_nearby
             FROM request r
             INNER JOIN search_file sf ON sf.request_id = r.id
             INNER JOIN search_match sm ON sm.search_file_id = sf.id
             INNER JOIN search_condition sc ON sc.id = sm.search_condition_id
             WHERE r.body_digest IN (${bodyDigests.map(() => '?').join(',')})`,
          )
          .all(...bodyDigests)
      : [];

  const matchedConditions: Record<
    string,
    { id: number; regex: string; not_regex_nearby: string | null }[]
  > = {};
  for (const row of matchedConditionsRaw) {
    (matchedConditions[row.body_digest] ??= []).push({
      id: row.condition_id,
      regex: row.regex,
      not_regex_nearby: row.not_regex_nearby,
    });
  }

  return {
    files,
    totalFiles,
    totalPages,
    currentPage: safePage,
    reactionTypes,
    domains,
    filterDomains: activeDomainIds ?? [],
    activeReactions,
    matchedConditions,
  };
}
