"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface DomainStats {
  id: string;
  domain: string;
  resources: number;
  downloaded: number;
  errored: number;
  pending: number;
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<DomainStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/domains_stats")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(setDomains)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="p-8 text-destructive">{error}</p>;

  return (
    <div className="container max-w-4xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-6">Domains</h1>

      {domains && domains.length === 0 && (
        <p className="text-muted-foreground">No domains found.</p>
      )}

      {domains && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((d) => (
            <Card key={d.id}>
              <CardHeader className="py-3 px-4 pb-0">
                <p className="font-semibold">{d.domain}</p>
              </CardHeader>
              <CardContent className="px-4 py-3 flex flex-wrap gap-2">
                <Badge variant="secondary">{d.resources} resources</Badge>
                <Badge variant="default">{d.downloaded} downloaded</Badge>
                {d.errored > 0 && (
                  <Badge variant="destructive">{d.errored} errored</Badge>
                )}
                {d.pending > 0 && (
                  <Badge variant="outline">{d.pending} pending</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
