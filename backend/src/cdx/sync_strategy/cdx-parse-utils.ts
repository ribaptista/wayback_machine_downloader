export interface ParsedCdxEntry {
  line: number;
  urlKey: string | null;
  timestamp: number | null;
  original: string | null;
  mimetype: string | null;
  statusCode: number | null;
  digest: string | null;
  length: number | null;
  raw: string;
}

export function parseStringField(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

export function parseIntField(raw: unknown): number | null {
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;
  if (typeof raw !== 'string') return null;
  const n = parseInt(raw);
  return isNaN(n) ? null : n;
}
