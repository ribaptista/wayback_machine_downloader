import { IncomingHttpHeaders } from '../http/types';
import { normalizeUrl } from '../http/normalized_url';

export class NonReplayResponseError extends Error {
  constructor() {
    super('Response missing x-archive-orig-* headers');
    this.name = 'NonReplayResponseError';
  }
}

export class InvalidReplayUrlFormat extends Error {
  constructor(url: string) {
    super(`Invalid replay URL: ${url}`);
    this.name = 'InvalidReplayUrlFormat';
  }
}

const REPLAY_URL_SUFFIX_REGEX = /^(\d+)id_\/(.+)$/;

export interface ParsedOriginalUrl {
  normalizedUrl: string;
  domain: string;
  normalizedDomain: string;
}

export interface ParsedReplayUrl {
  timestamp: number;
  original: string;
  parsedOriginalUrl: ParsedOriginalUrl;
}

export class ReplayServer {
  constructor(private readonly baseUrl: string) {}

  private parseOriginalUrl(original: string): ParsedOriginalUrl {
    const normalized = normalizeUrl(original);
    return {
      normalizedUrl: normalized.toString(),
      domain: new URL(original).hostname,
      normalizedDomain: normalized.getNormalizedDomain(),
    };
  }

  parseReplayUrl(url: string): ParsedReplayUrl {
    if (!url.startsWith(this.baseUrl)) throw new InvalidReplayUrlFormat(url);
    const suffix = url.slice(this.baseUrl.length);
    const m = REPLAY_URL_SUFFIX_REGEX.exec(suffix);
    if (!m) throw new InvalidReplayUrlFormat(url);
    const original = m[2];
    return {
      timestamp: parseInt(m[1], 10),
      original,
      parsedOriginalUrl: this.parseOriginalUrl(original),
    };
  }

  buildRawReplayUrl(timestamp: number, original: string): string {
    return `${this.baseUrl}${timestamp}id_/${original}`;
  }

  buildLiveReplayUrl(timestamp: number, original: string): string {
    return `${this.baseUrl}${timestamp}/${original}`;
  }

  validateReplayResponse(
    headers: IncomingHttpHeaders,
  ): NonReplayResponseError | undefined {
    const hasArchiveOrigHeaders = Object.keys(headers).some((k) =>
      k.toLowerCase().startsWith('x-archive-orig-'),
    );
    if (!hasArchiveOrigHeaders) return new NonReplayResponseError();
  }
}
