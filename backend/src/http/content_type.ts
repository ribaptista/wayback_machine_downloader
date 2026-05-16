import { detectEncodingHttp, type DetectedEncoding } from '../storage/encoding';
import type { IncomingHttpHeaders } from './types';

export interface ContentType {
  mimeType: string | undefined;
  encoding: DetectedEncoding | undefined;
}

function resolveContentTypeHeader(
  headers: IncomingHttpHeaders,
  url: string,
): string | undefined {
  const value = headers['content-type'];
  if (!Array.isArray(value)) return value;
  console.warn(`Multiple content-type headers for ${url}`);
  return value[0];
}

export function resolveContentType(
  headers: IncomingHttpHeaders,
  url: string,
  body: Buffer | undefined,
): ContentType {
  const contentTypeHeader = resolveContentTypeHeader(headers, url);
  const mimeType = contentTypeHeader
    ? contentTypeHeader.split(';')[0].trim()
    : undefined;
  const encoding =
    body !== undefined && mimeType === 'text/html'
      ? detectEncodingHttp(contentTypeHeader, body)
      : undefined;
  return { mimeType, encoding };
}
