"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileResultCard, DynamicIcon } from "@/components/FileResultCard";
import type { ContextWindow, ReactionType } from "@/components/FileResultCard";

interface SearchInfo {
  id: number;
  created_at: string;
  char_encoding: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_message: string | null;
}

interface Condition {
  id: number;
  regex: string;
  not_regex_nearby: string | null;
}

interface Domain {
  id: string;
  domain: string;
}

interface FileResult {
  id: number;
  body_digest: string;
  match_count: number;
  duplicate_count: number;
  context_digest: string | null;
  original: string;
  timestamp: string;
  fileError: string | null;
  contextWindows: ContextWindow[];
}

interface SearchResultsData {
  search: SearchInfo;
  conditions: Condition[];
  domains: Domain[];
  files: FileResult[];
  totalFiles: number;
  totalPages: number;
  currentPage: number;
  searchId: number;
  similarTo: string | null;
  isPending: boolean;
  filterDomains: string[];
  filterConditionIds: number[];
  filterReactionTypeIds: number[];
  reactionTypes: ReactionType[];
  activeReactions: string[];
}

function statusBadge(status: string) {
  if (status === "done") return <Badge>done</Badge>;
  if (status === "running") return <Badge variant="secondary">running</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function SearchResultsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const searchId = Number(params.get("search_id"));
  const page = Number(params.get("page") ?? "1");
  const similarTo = params.get("similar_to") ?? undefined;
  const filterDomains = useMemo(() => params.getAll("domain[]"), [params]);
  const filterConditionIds = useMemo(() => params.getAll("condition_id[]").map(Number), [params]);
  const filterReactionTypeIds = useMemo(() => params.getAll("reaction_type_id[]").map(Number), [params]);

  const [data, setData] = useState<SearchResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeReactions, setActiveReactions] = useState<Set<string>>(new Set());

  // Local filter state (applied on button click)
  const [localDomains, setLocalDomains] = useState<Set<string>>(new Set(filterDomains));
  const [localConditions, setLocalConditions] = useState<Set<number>>(new Set(filterConditionIds));
  const [localReactions, setLocalReactions] = useState<Set<number>>(new Set(filterReactionTypeIds));

  const buildApiUrl = useCallback(() => {
    const q = new URLSearchParams();
    q.set("search_id", String(searchId));
    if (page > 1) q.set("page", String(page));
    if (similarTo) q.set("similar_to", similarTo);
    for (const d of filterDomains) q.append("domain[]", d);
    for (const id of filterConditionIds) q.append("condition_id[]", String(id));
    for (const id of filterReactionTypeIds) q.append("reaction_type_id[]", String(id));
    return `/api/search_results?${q}`;
  }, [searchId, page, similarTo, filterDomains, filterConditionIds, filterReactionTypeIds]);

  const load = useCallback(() => {
    if (!searchId) return;
    fetch(buildApiUrl())
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((d: SearchResultsData) => {
        setData(d);
        setActiveReactions(new Set(d.activeReactions));
        setLocalDomains(d.filterDomains.length > 0 ? new Set(d.filterDomains) : new Set(d.domains.map((x: Domain) => x.id)));
        setLocalConditions(d.filterConditionIds.length > 0 ? new Set(d.filterConditionIds) : new Set(d.conditions.map((x: Condition) => x.id)));
        setLocalReactions(new Set(d.filterReactionTypeIds));
      })
      .catch((e) => setError(e.message));
  }, [buildApiUrl, searchId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh || !data?.isPending) return;
    const id = setTimeout(load, 3000);
    return () => clearTimeout(id);
  }, [autoRefresh, data, load]);

  function applyFilters() {
    const u = new URLSearchParams();
    u.set("search_id", String(searchId));
    u.set("page", "1");
    if (similarTo) u.set("similar_to", similarTo);
    // If all domains selected (or none deselected), don't include filter
    const allDomains = data?.domains ?? [];
    const allSelected = allDomains.every((d) => localDomains.has(d.id));
    if (!allSelected) for (const id of localDomains) u.append("domain[]", id);
    const allConds = data?.conditions ?? [];
    const allCondsSelected = allConds.every((c) => localConditions.has(c.id));
    if (!allCondsSelected) for (const id of localConditions) u.append("condition_id[]", String(id));
    for (const id of localReactions) u.append("reaction_type_id[]", String(id));
    router.push(`/search_results?${u}`);
  }

  function getPageRange(current: number, total: number): number[] {
    const half = 5;
    let start = Math.max(1, current - half);
    let end = Math.min(total, current + half);
    if (end - start < 10) {
      if (start === 1) end = Math.min(total, start + 10);
      else if (end === total) start = Math.max(1, end - 10);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  function buildPageUrl(p: number) {
    const u = new URLSearchParams(params.toString());
    u.set("page", String(p));
    return `/search_results?${u}`;
  }

  async function toggleReaction(bodyDigest: string, reactionTypeId: number) {
    const key = `${bodyDigest}:${reactionTypeId}`;
    const isActive = activeReactions.has(key);
    const res = await fetch("/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body_digest: bodyDigest, reaction_type_id: reactionTypeId, active: !isActive }),
    });
    if (!res.ok) return;
    const result = await res.json();
    setActiveReactions((prev) => {
      const next = new Set(prev);
      // Remove all reactions for this digest, then add active ones
      for (const rt of data?.reactionTypes ?? []) next.delete(`${bodyDigest}:${rt.id}`);
      for (const id of result.activeReactionTypeIds) next.add(`${bodyDigest}:${id}`);
      return next;
    });
  }

  if (!searchId) return <p className="p-8 text-destructive">Missing search_id</p>;
  if (error) return <p className="p-8 text-destructive">{error}</p>;

  const { search, conditions, domains, files, totalFiles, totalPages, currentPage } = data ?? {
    search: null, conditions: [], domains: [], files: [], totalFiles: 0, totalPages: 0, currentPage: 1,
  };
  const pct = (search?.file_count ?? 0) > 0
    ? Math.round(((search?.scanned_file_count ?? 0) / (search?.file_count ?? 1)) * 100)
    : 0;

  const filterSuffix = () => {
    const parts: string[] = [];
    for (const id of filterDomains) parts.push(`domain[]=${encodeURIComponent(id)}`);
    for (const id of filterConditionIds) parts.push(`condition_id[]=${id}`);
    for (const id of filterReactionTypeIds) parts.push(`reaction_type_id[]=${id}`);
    return parts.length ? `&${parts.join("&")}` : "";
  };

  return (
    <div className="container max-w-4xl py-8 mx-auto px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Search Results</h1>
        {data?.isPending && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}>↻ Refresh</Button>
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              Auto Refresh: {autoRefresh ? "On" : "Off"}
            </Button>
          </div>
        )}
      </div>

      {/* Search info card */}
      {data && search && (
      <Card className="mb-4">
        <CardContent className="py-3 space-y-1 text-sm">
          <p><strong>Search ID:</strong> {search.id}</p>
          <p><strong>Created:</strong> {search.created_at}</p>
          <p><strong>Encoding:</strong> {search.char_encoding}</p>
          <p className="flex items-center gap-2"><strong>Status:</strong> {statusBadge(search.status)}</p>
          {data.isPending && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Scanning files…</span>
                <span>{search.scanned_file_count} / {search.file_count} ({pct}%)</span>
              </div>
              <Progress value={pct} className="h-2" />
            </div>
          )}
          {search.status === "error" && (
            <p className="text-destructive"><strong>Error:</strong> {search.error_message}</p>
          )}
        </CardContent>
      </Card>
      )}

      {/* Filters + results */}
      {data && (<>

      {/* Filters */}
      <Card className="mb-4">
        <CardHeader className="py-2 px-4 font-semibold text-sm">Filter Results</CardHeader>
        <CardContent className="py-3 space-y-3">
          {domains.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1">Domains</p>
              <div className="flex flex-wrap gap-2">
                {domains.map((d) => (
                  <Button
                    key={d.id}
                    variant={localDomains.has(d.id) ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      setLocalDomains((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                        return next;
                      })
                    }
                  >
                    {d.domain}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {conditions.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1">Conditions</p>
              <div className="flex flex-wrap gap-2">
                {conditions.map((c) => (
                  <Button
                    key={c.id}
                    variant={localConditions.has(c.id) ? "default" : "outline"}
                    size="sm"
                    className="h-auto py-1 flex flex-col items-start"
                    onClick={() =>
                      setLocalConditions((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        return next;
                      })
                    }
                  >
                    <span>{c.regex}</span>
                    {c.not_regex_nearby && (
                      <span className={`font-normal text-xs ${localConditions.has(c.id) ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                        NOT NEAR {c.not_regex_nearby}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {data.reactionTypes.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1">Only reacted</p>
              <div className="flex flex-wrap gap-2">
                {data.reactionTypes.map((rt) => (
                  <Button
                    key={rt.id}
                    variant={localReactions.has(rt.id) ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      setLocalReactions((prev) => {
                        const next = new Set(prev);
                        if (next.has(rt.id)) next.delete(rt.id); else next.add(rt.id);
                        return next;
                      })
                    }
                  >
                    <DynamicIcon name={rt.emoji} active={localReactions.has(rt.id)} />
                    {rt.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <Button size="sm" onClick={applyFilters}>Update Filters</Button>
        </CardContent>
      </Card>

      <h2 className="text-base font-semibold mb-2">Files with Matches ({totalFiles})</h2>

      {similarTo && (
        <div className="bg-muted text-muted-foreground text-sm rounded px-3 py-2 mb-3">
          Showing all results with context digest: <code>{similarTo}</code>
          {" — "}
          <button
            className="underline"
            onClick={() => router.push(`/search_results?search_id=${searchId}${filterSuffix()}`)}
          >
            Back to deduplicated results
          </button>
        </div>
      )}

      {/* Pagination top */}
      {totalPages > 1 && (
        <div className="flex flex-wrap gap-1 mb-3">
          <Button
            variant="outline" size="sm"
            disabled={currentPage === 1}
            onClick={() => router.push(buildPageUrl(currentPage - 1))}
          >«</Button>
          {getPageRange(currentPage, totalPages).map((p) => (
            <Button
              key={p}
              variant={p === currentPage ? "default" : "outline"}
              size="sm"
              onClick={() => router.push(buildPageUrl(p))}
            >{p}</Button>
          ))}
          <Button
            variant="outline" size="sm"
            disabled={currentPage === totalPages}
            onClick={() => router.push(buildPageUrl(currentPage + 1))}
          >»</Button>
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-muted-foreground">No matches found.</p>
      ) : (
        <div className="space-y-3">
          {files.map((file) => (
            <FileResultCard
              key={file.id}
              bodyDigest={file.body_digest}
              original={file.original}
              timestamp={file.timestamp}
              matchCount={file.match_count}
              duplicateCount={!similarTo ? file.duplicate_count : undefined}
              contextWindows={file.contextWindows}
              fileError={file.fileError}
              reactionTypes={data.reactionTypes}
              activeReactions={activeReactions}
              onToggleReaction={toggleReaction}
              onSimilarClick={
                !similarTo && file.duplicate_count > 1
                  ? () => router.push(`/search_results?search_id=${searchId}&similar_to=${file.context_digest}${filterSuffix()}`)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="flex flex-wrap gap-1 mt-3">
          <Button
            variant="outline" size="sm"
            disabled={currentPage === 1}
            onClick={() => router.push(buildPageUrl(currentPage - 1))}
          >«</Button>
          {getPageRange(currentPage, totalPages).map((p) => (
            <Button
              key={p}
              variant={p === currentPage ? "default" : "outline"}
              size="sm"
              onClick={() => router.push(buildPageUrl(p))}
            >{p}</Button>
          ))}
          <Button
            variant="outline" size="sm"
            disabled={currentPage === totalPages}
            onClick={() => router.push(buildPageUrl(currentPage + 1))}
          >»</Button>
        </div>
      )}
      </>)}
    </div>
  );
}

export default function SearchResultsPage() {
  return <SearchResultsInner />;
}
