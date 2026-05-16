import { request as undiciRequest } from 'undici';
import { type ProxyEntry } from './proxy';
import { IncomingHttpHeaders } from './types';

const ABORT_CONTROLLER_TIMEOUT_MS = 40_000;
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 20_000;

export interface RequestMetadata {
  durationMs: number;
  proxyAddress: string | null;
}

export interface RawResponse {
  url: string;
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  metadata: RequestMetadata;
}

export class NetworkFetchError extends Error {
  constructor(
    public readonly url: string,
    public readonly requestMetadata: RequestMetadata,
    public readonly cause: unknown,
  ) {
    super();
    this.name = 'NetworkFetchError';
  }
}

/**
 * Manages a pool of proxy entries.
 * acquire() picks the least-loaded proxy and increments its ongoing counter.
 * release() decrements the ongoing counter when the request is done.
 */
export class ProxyPool {
  constructor(private readonly proxies: ProxyEntry[]) {}

  private acquire(): ProxyEntry {
    const minOngoing = Math.min(...this.proxies.map((p) => p.ongoing));
    const candidates = this.proxies.filter((p) => p.ongoing === minOngoing);
    const proxy = candidates[Math.floor(Math.random() * candidates.length)];
    proxy.ongoing++;
    return proxy;
  }

  private release(proxy: ProxyEntry): void {
    proxy.ongoing--;
  }

  async fetch(url: string): Promise<RawResponse> {
    const proxy = this.acquire();
    const ac = new AbortController();
    const timeout = setTimeout(
      () => ac.abort(new Error('request timed out')),
      ABORT_CONTROLLER_TIMEOUT_MS,
    );
    const fetchStart = Date.now();
    try {
      const { statusCode, headers, body } = await undiciRequest(url, {
        method: 'GET',
        dispatcher: proxy.agent,
        signal: ac.signal,
        headersTimeout: HEADER_TIMEOUT_MS,
        bodyTimeout: BODY_TIMEOUT_MS,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      return {
        url,
        statusCode,
        headers,
        body: Buffer.concat(chunks),
        metadata: {
          durationMs: Date.now() - fetchStart,
          proxyAddress: proxy.address,
        },
      };
    } catch (cause) {
      throw new NetworkFetchError(
        url,
        { durationMs: Date.now() - fetchStart, proxyAddress: proxy.address },
        cause,
      );
    } finally {
      clearTimeout(timeout);
      this.release(proxy);
    }
  }
}
