"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { REPLAY_SERVER_URL } from "@/lib/config";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

interface Version {
  timestamp: number;
  successful_request_id: string | null;
  status: "pending" | "error" | "ok" | "redirect";
  error_code: string | null;
  error_message: string | null;
  location_original: string | null;
  location_timestamp: number | null;
}

interface BreadcrumbPart {
  label: string;
  path: string;
  level: number;
}

interface ListVersionsData {
  url: string;
  versions: Version[];
  breadcrumbs: BreadcrumbPart[];
}

function statusBadge(status: string) {
  if (status === "ok") return <Badge variant="default">ok</Badge>;
  if (status === "redirect") return <Badge variant="secondary">redirect</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="outline">pending</Badge>;
}

function ListVersionsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const url = params.get("url") ?? "";

  const [data, setData] = useState<ListVersionsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    fetch(`/api/list_versions?url=${encodeURIComponent(url)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [url]);

  if (!url) return <p className="p-8 text-destructive">Missing url parameter</p>;
  if (error) return <p className="p-8 text-destructive">{error}</p>;

  return (
    <div className="container max-w-4xl py-8 mx-auto px-4">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink onClick={() => router.push("/resources")} className="cursor-pointer">
              All domains
            </BreadcrumbLink>
          </BreadcrumbItem>
          {(data?.breadcrumbs ?? []).map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {i === (data?.breadcrumbs.length ?? 0) - 1 ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    onClick={() => router.push(`/resources?path=${encodeURIComponent(crumb.path)}&level=${crumb.level}`)}
                    className="cursor-pointer"
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="text-xl font-bold mb-1">Versions</h1>
      <p className="text-muted-foreground text-sm mb-4 break-all">{url}</p>

      {!data ? null : data.versions.length === 0 ? (
        <p className="text-muted-foreground">No versions found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {data.versions.map((v) => {
            const ts = String(v.timestamp);
            return (
              <li key={v.timestamp} className="flex items-center gap-2 px-4 py-2 text-sm flex-wrap">
                {v.status === "ok" || v.status === "redirect" ? (
                  <a
                    className="text-primary hover:underline"
                    href={`${REPLAY_SERVER_URL}/replay/${v.timestamp}/${data.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {ts}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{ts}</span>
                )}

                {statusBadge(v.status)}

                {v.status === "redirect" && v.location_original && (
                  <span className="text-muted-foreground text-xs">
                    →{" "}
                    <a
                      className="hover:underline"
                      href={`${REPLAY_SERVER_URL}/replay/${v.location_timestamp}/${v.location_original}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {v.location_original}
                    </a>
                  </span>
                )}

                {v.status === "error" && (
                  <>
                    {v.error_code && <code className="text-xs text-destructive">{v.error_code}</code>}
                    {v.error_message && (
                      <span
                        className="text-muted-foreground text-xs truncate max-w-xs"
                        title={v.error_message}
                      >
                        {v.error_message}
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ListVersionsPage() {
  return <ListVersionsInner />;
}
