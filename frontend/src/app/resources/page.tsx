"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

interface TreeNode {
  path: string;
  level: number;
  is_leaf: number;
}

interface BreadcrumbPart {
  label: string;
  path: string;
  level: number;
}

interface ResourcesData {
  nodes: TreeNode[];
  path: string | null;
  breadcrumbs: BreadcrumbPart[];
}

function ResourcesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const filterPath = params.get("path") ?? null;
  const filterLevel = filterPath !== null ? Number(params.get("level") ?? "0") : 0;

  const [data, setData] = useState<ResourcesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (filterPath !== null) {
      q.set("path", filterPath);
      q.set("level", String(filterLevel));
    }
    fetch(`/api/resources?${q}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  }, [filterPath, filterLevel]);

  function navigateTo(path: string, level: number) {
    const q = new URLSearchParams({ path, level: String(level) });
    router.push(`/resources?${q}`);
  }

  if (error) return <p className="p-8 text-destructive">{error}</p>;

  return (
    <div className="container max-w-4xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-4">Resources</h1>

      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          {(data?.breadcrumbs.length ?? 0) === 0 ? (
            <BreadcrumbItem>
              <BreadcrumbPage>All domains</BreadcrumbPage>
            </BreadcrumbItem>
          ) : (
            <>
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
                        onClick={() => navigateTo(crumb.path, crumb.level)}
                        className="cursor-pointer"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      {!data ? null : data.nodes.length === 0 ? (
        <p className="text-muted-foreground">No entries found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {data.nodes.map((node) => (
            <li key={node.path} className="flex items-center gap-2 px-4 py-2 text-sm">
              {node.is_leaf ? (
                <>
                  <button
                    className="text-primary break-all text-left hover:underline"
                    onClick={() =>
                      router.push(`/list_versions?url=${encodeURIComponent(node.path)}`)
                    }
                  >
                    {node.path}
                  </button>
                  <Badge variant="default" className="shrink-0">resource</Badge>
                </>
              ) : (
                <button
                  className="text-primary break-all text-left hover:underline"
                  onClick={() => navigateTo(node.path, node.level)}
                >
                  {node.path}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ResourcesPage() {
  return <ResourcesInner />;
}
