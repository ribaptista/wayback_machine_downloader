import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { gunzip } from 'zlib';
import { createHash, randomUUID } from 'crypto';
import { request as undiciRequest } from 'undici';
import type { DB } from '../db/conn';
import { pickProxy, type ProxyEntry } from '../http/proxy';
import { htmlExtractToFiles } from '../file/html';
import { normalizeUrl } from '../http/url';
import { nestedIdPath } from '../file/id-path';
import { detectEncoding } from '../file/encoding';
import { RequestRepository } from './repository';
import { CdxRepository } from '../cdx/repository';
import { RunRepository } from '../run/repository';

const gunzipAsync = promisify(gunzip);

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const ABORT_CONTROLLER_TIMEOUT_MS = 40_000;
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 20_000;
const MAX_REDIRECT_COUNT = 20;

const WAYBACK_SUFFIX_RE = /^(\d+)id_\/(.+)$/;

interface ParsedWaybackUrl {
  timestamp: number;
  original: string;
}

function parseWaybackUrl(
  url: string,
  replayBaseUrl: string,
): ParsedWaybackUrl | null {
  if (!url.startsWith(replayBaseUrl)) return null;
  const suffix = url.slice(replayBaseUrl.length);
  const m = WAYBACK_SUFFIX_RE.exec(suffix);
  if (!m) return null;
  return { timestamp: parseInt(m[1], 10), original: m[2] };
}

function buildWaybackUrl(
  replayBaseUrl: string,
  timestamp: number | null,
  original: string,
): string {
  return `${replayBaseUrl}${timestamp ?? ''}id_/${original}`;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

// Use undici.request() which does NOT decompress automatically.
// The Wayback Machine sends `content-encoding: gzip` even for plain text,
// so we ignore that header entirely and detect gzip ourselves via magic bytes.
async function fetchNoRedirect(
  url: string,
  proxy: ProxyEntry,
): Promise<RawResponse> {
  const ac = new AbortController();
  const timeout = setTimeout(
    () => ac.abort(new Error('request timed out')),
    ABORT_CONTROLLER_TIMEOUT_MS,
  );
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
      status: statusCode,
      headers: headers,
      body: Buffer.concat(chunks),
    } as RawResponse;
  } finally {
    clearTimeout(timeout);
  }
}

interface RequestError {
  name?: string;
  code: string;
  message: string;
}

function parseError(err: unknown): RequestError {
  if (err instanceof Error) {
    return {
      name: err.name,
      code: (err as { code?: string }).code ?? 'general',
      message: err.message,
    };
  }
  return {
    code: 'general',
    message: `Invalid error object: ${JSON.stringify(err)}`,
  };
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399;
}

function getLocation(
  headers: Record<string, string | string[] | undefined>,
): string[] {
  const val = headers['location'];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export interface DownloadTask {
  runId: string;
  timestamp: number | null;
  original: string;
  domainName: string;
  normalizedDomain: string;
  outputFolder: string;
  replayBaseUrl: string;
}

interface ResourceVersionState {
  successfulRequestId: string | null;
  lastErroredRequestId: string | null;
  status: 'pending' | 'errored' | 'successful';
}

export async function downloadEntry(
  db: DB,
  reqRepo: RequestRepository,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  task: DownloadTask,
  proxies: ProxyEntry[],
): Promise<boolean> {
  function getResourceVersionState(
    urlOriginal: string,
    urlTimestamp: number,
  ): ResourceVersionState {
    const row = cdxRepo.getResourceVersionState(urlOriginal, urlTimestamp);
    if (!row)
      throw new Error(
        `resource_version not found: ${urlOriginal} @ ${urlTimestamp}`,
      );
    const {
      successful_request_id: successfulRequestId,
      last_errored_request_id: lastErroredRequestId,
    } = row;
    if (successfulRequestId != null && lastErroredRequestId != null)
      throw new Error(
        `Refreshing a previously successful resource is not implemented: ${urlOriginal} @ ${urlTimestamp}`,
      );
    const status: ResourceVersionState['status'] =
      successfulRequestId == null && lastErroredRequestId == null
        ? 'pending'
        : successfulRequestId == null
          ? 'errored'
          : 'successful';
    return { successfulRequestId, lastErroredRequestId, status };
  }

  let currentUrl = buildWaybackUrl(
    task.replayBaseUrl,
    task.timestamp,
    task.original,
  );

  // Returns true if this is the first successful download of the resource
  // (used to decide whether to keep generated files).
  // Uses optimistic locking: if .changes === 0, another worker won the race.
  function applySuccessfulResourceVersionResult(
    urlOriginal: string,
    urlTimestamp: number,
    requestId: string,
  ): boolean {
    const { successfulRequestId, lastErroredRequestId, status } =
      getResourceVersionState(urlOriginal, urlTimestamp);
    // Treat an already-successful resource as a concurrent winner — don't
    // overwrite the existing successful_request_id or touch any counters.
    if (status === 'successful') return false;
    const r = cdxRepo.setSuccessfulRequest(
      requestId,
      urlOriginal,
      urlTimestamp,
      successfulRequestId,
      lastErroredRequestId,
    );
    if (r.changes === 0) return false; // lost race
    switch (status) {
      case 'pending':
        cdxRepo.updateDomainCounters(1, 0, -1, urlOriginal, urlTimestamp);
        return true;
      case 'errored':
        cdxRepo.updateDomainCounters(1, -1, 0, urlOriginal, urlTimestamp);
        return true;
    }
  }

  // Uses optimistic locking: if .changes === 0, another worker won the race.
  function applyErroredResourceVersionResult(
    urlOriginal: string,
    urlTimestamp: number,
    requestId: string,
  ): void {
    const { successfulRequestId, lastErroredRequestId, status } =
      getResourceVersionState(urlOriginal, urlTimestamp);
    // Treat an already-successful resource as a concurrent winner — don't
    // overwrite the existing successful_request_id or touch any counters.
    if (status === 'successful') return;
    const r = cdxRepo.setLastErroredRequest(
      requestId,
      urlOriginal,
      urlTimestamp,
      successfulRequestId,
      lastErroredRequestId,
    );
    if (r.changes === 0) return; // lost race
    switch (status) {
      case 'pending':
        cdxRepo.updateDomainCounters(0, 1, -1, urlOriginal, urlTimestamp);
        break;
      // errored    → no counter change (already in errored bucket)
    }
  }
  let redirectChainCount = 0;
  const { runId, outputFolder } = task;
  const visitedUrls = new Set<string>();

  while (true) {
    const proxy = pickProxy(proxies);
    proxy.ongoing++;

    const parsedUrl = parseWaybackUrl(currentUrl, task.replayBaseUrl);
    if (!parsedUrl) throw new Error(`Invalid Wayback URL: ${currentUrl}`);
    const urlOriginal = parsedUrl.original;
    const urlTimestamp = parsedUrl.timestamp;

    // Isolated fetch — only network/timeout errors are caught here.
    let response: RawResponse;
    let fetchDurationMs: number = 0;
    let fetchStart: number = Date.now();
    try {
      try {
        response = await proxy.limiter.schedule(() => {
          fetchStart = Date.now();
          return fetchNoRedirect(currentUrl, proxy);
        });
      } finally {
        fetchDurationMs = Date.now() - fetchStart;
        proxy.ongoing--;
      }
    } catch (err) {
      const errorID = randomUUID();
      const re = reqRepo.insertRequest({
        id: errorID,
        runId,
        resourceVersionUrl: urlOriginal,
        resourceVersionTimestamp: urlTimestamp,
        statusCode: null,
        bodyDigest: null,
        inferredGzip: null,
        durationMs: fetchDurationMs,
        proxyAddress: proxy.address === 'direct' ? null : proxy.address,
        isSuccessful: 0,
        mimetype: null,
        location: null,
        locationOriginal: null,
        locationTimestamp: null,
        encoding: null,
        encodingSource: null,
        chardetConfidence: null,
        isForeignRedirect: null,
        redirectDomain: null,
        redirectNormalizedDomain: null,
      });
      if (re.changes === 0) return true;
      const {
        name: errName,
        code: errCode,
        message: errMessage,
      } = parseError(err);
      reqRepo.insertError(errorID, errName ?? '', errCode, errMessage);
      runRepo.incrementStats(0, 1, runId);
      runRepo.upsertDomainStats(runId, task.domainName, 0, 1);
      runRepo.upsertErrorTypeStats(
        runId,
        task.domainName,
        errName ?? '',
        errCode,
      );
      applyErroredResourceVersionResult(urlOriginal, urlTimestamp, errorID);
      return false;
    }

    // Everything below is post-fetch. Errors here propagate and crash the script.
    const statusCode = response.status;
    const responseHeaders = response.headers;
    const errors: RequestError[] = [];

    const locationHeaders = getLocation(responseHeaders);
    let locationHeader: string | null = null;
    if (locationHeaders.length === 1) {
      locationHeader = locationHeaders[0];
    }
    const resolvedLocation = locationHeader
      ? new URL(locationHeader, currentUrl).toString()
      : null;
    const parsedRedirectTarget =
      isRedirect(statusCode) && resolvedLocation !== null
        ? parseWaybackUrl(resolvedLocation, task.replayBaseUrl)
        : null;
    const redirectLoop =
      isRedirect(statusCode) &&
      resolvedLocation !== null &&
      visitedUrls.has(resolvedLocation);
    const maxRedirectsReached =
      isRedirect(statusCode) &&
      locationHeader !== null &&
      redirectChainCount >= MAX_REDIRECT_COUNT;

    // Body is already fully read without any decompression applied
    const rawBody: Buffer = response.body;

    // Detect gzip by magic bytes
    let finalBody: Buffer | null = rawBody;
    let inferredGzip = false;
    if (
      rawBody &&
      rawBody.length >= 2 &&
      rawBody.subarray(0, 2).equals(GZIP_MAGIC)
    ) {
      inferredGzip = true;
      try {
        finalBody = await gunzipAsync(rawBody);
      } catch (e) {
        errors.push({
          code: 'gzip',
          message: `Gzip decompression failed: ${(e as Error).message}`,
        });
        finalBody = null;
      }
    }

    if (isRedirect(statusCode) && locationHeader === null) {
      errors.push({
        code: 'redirect_no_location',
        message: `Redirect response (${statusCode}) missing Location header`,
      });
    }

    if (isRedirect(statusCode) && locationHeaders.length > 1) {
      errors.push({
        code: 'multiple_location_headers',
        message: `Multiple Location headers received: ${locationHeaders.join(', ')}`,
      });
    }

    if (maxRedirectsReached) {
      errors.push({
        code: 'redirect_limit_exceeded',
        message: `Redirect chain exceeded maxium hop count`,
      });
    }

    if (redirectLoop) {
      errors.push({
        code: 'redirect_loop',
        message: `Redirect loop detected: ${resolvedLocation} was already visited`,
      });
    }

    const hasArchiveOrigHeaders = Object.keys(responseHeaders).some((k) =>
      k.toLowerCase().startsWith('x-archive-orig-'),
    );

    if (!isRedirect(statusCode) && !hasArchiveOrigHeaders) {
      errors.push({
        code: 'missing_original_headers',
        message: 'Response missing x-archive-orig-* headers',
      });
    }

    if (isRedirect(statusCode) && parsedRedirectTarget === null) {
      errors.push({
        code: 'unsupported_redirect_target',
        message: `Redirect target is not a Wayback Machine archive URL: ${resolvedLocation}`,
      });
    }

    // Compute digest
    let bodyDigest: string | null = null;
    if (finalBody) {
      bodyDigest = createHash('sha256').update(finalBody).digest('base64url');
    }

    const requestId = randomUUID();
    const contentTypeRaw = responseHeaders['content-type'];
    const contentTypeStr = Array.isArray(contentTypeRaw)
      ? contentTypeRaw[0]
      : (contentTypeRaw ?? null);
    const responseMimetype = contentTypeStr
      ? contentTypeStr.split(';')[0].trim()
      : null;

    // Detect encoding for HTML responses
    const detectedEncoding =
      responseMimetype === 'text/html' && finalBody
        ? detectEncoding(responseHeaders, finalBody)
        : null;

    // Compute redirect domain metadata
    let isForeignRedirect: boolean | null = null;
    let redirectDomain: string | null = null;
    let redirectNormalizedDomain: string | null = null;
    let redirectNormalizedUrl: string | null = null;
    if (parsedRedirectTarget !== null) {
      try {
        redirectNormalizedUrl = normalizeUrl(parsedRedirectTarget.original);
        redirectDomain = new URL(parsedRedirectTarget.original).hostname;
        redirectNormalizedDomain = redirectNormalizedUrl.split('/')[0];
        isForeignRedirect =
          redirectNormalizedDomain !== task.normalizedDomain &&
          !redirectNormalizedDomain.endsWith('.' + task.normalizedDomain);
      } catch {
        errors.push({
          code: 'redirect_domain_parse_error',
          message: `Failed to parse redirect target URL: ${parsedRedirectTarget.original}`,
        });
      }
    }

    const isSuccessful = errors.length === 0;

    // Insert request row, errors, and headers in a single transaction
    let skipped = false;
    let redirectTargetIsNew = false;
    let isNewSuccessfulRequest = false;
    const insertAll = db.transaction(() => {
      const ir = reqRepo.insertRequest({
        id: requestId,
        runId,
        resourceVersionUrl: urlOriginal,
        resourceVersionTimestamp: urlTimestamp,
        statusCode,
        bodyDigest,
        inferredGzip: inferredGzip ? 1 : 0,
        durationMs: fetchDurationMs,
        proxyAddress: proxy.address === 'direct' ? null : proxy.address,
        isSuccessful: isSuccessful ? 1 : 0,
        mimetype: responseMimetype,
        location: locationHeader,
        locationOriginal: parsedRedirectTarget?.original ?? null,
        locationTimestamp: parsedRedirectTarget?.timestamp ?? null,
        encoding: detectedEncoding?.encoding ?? null,
        encodingSource: detectedEncoding?.source ?? null,
        chardetConfidence: detectedEncoding?.chardetConfidence ?? null,
        isForeignRedirect:
          isForeignRedirect !== null ? (isForeignRedirect ? 1 : 0) : null,
        redirectDomain,
        redirectNormalizedDomain,
      });
      if (ir.changes === 0) {
        skipped = true;
        return;
      }

      runRepo.incrementStats(isSuccessful ? 1 : 0, isSuccessful ? 0 : 1, runId);
      runRepo.upsertDomainStats(
        runId,
        task.domainName,
        isSuccessful ? 1 : 0,
        isSuccessful ? 0 : 1,
      );

      for (const { name = '', code, message } of errors) {
        reqRepo.insertError(requestId, name, code, message);
        runRepo.upsertErrorTypeStats(runId, task.domainName, name, code);
      }

      for (const [name, value] of Object.entries(responseHeaders)) {
        if (value === undefined) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          reqRepo.insertHeader(requestId, name, v);
        }
      }

      if (isRedirect(statusCode) && isSuccessful && !isForeignRedirect) {
        cdxRepo.insertTreeNodePaths([redirectNormalizedUrl!]);
        cdxRepo.insertOrIgnoreResource(
          parsedRedirectTarget!.original,
          redirectNormalizedUrl!,
        );
        const r = cdxRepo.insertOrIgnoreResourceVersion(
          // non-null inferred from if condition
          parsedRedirectTarget!.original,
          parsedRedirectTarget!.timestamp,
        );
        redirectTargetIsNew = r.changes > 0;
        const rvsr = cdxRepo.insertOrIgnoreResourceVersionSource(
          parsedRedirectTarget!.original,
          parsedRedirectTarget!.timestamp,
          task.domainName,
        );
        if (rvsr.changes > 0) {
          cdxRepo.incrementDomainEntryCount(task.domainName);
        }
      }

      if (isSuccessful) {
        isNewSuccessfulRequest = applySuccessfulResourceVersionResult(
          urlOriginal,
          urlTimestamp,
          requestId,
        );
      } else {
        applyErroredResourceVersionResult(urlOriginal, urlTimestamp, requestId);
      }
    });

    let finalAssetPath: string | null = null;
    let rawBodyPath: string | null = null;

    if (inferredGzip) {
      rawBodyPath = await saveRawBody(
        rawBody,
        finalBody !== null,
        requestId,
        outputFolder,
        runId,
      );
    }
    if (bodyDigest) {
      finalAssetPath = nestedIdPath(
        path.join(outputFolder, 'assets'),
        bodyDigest,
        2,
      );
      const isNewFile = await saveFinalBody(
        finalBody!,
        finalAssetPath,
        requestId,
        outputFolder,
        runId,
      );
      if (isNewFile && responseMimetype === 'text/html') {
        await htmlExtractToFiles(finalAssetPath, finalAssetPath, {
          skipTags: [
            'script',
            'style',
            'head',
            'template',
            'meta',
            'link',
            'base',
            'noscript',
            'svg',
            'math',
          ],
          inputEncoding: detectedEncoding?.encoding,
        });
      }
    }

    insertAll();

    if (skipped) {
      await deleteGeneratedFiles(rawBodyPath);
      return true;
    }

    if (isSuccessful && !isNewSuccessfulRequest) {
      await deleteGeneratedFiles(rawBodyPath);
    }

    // Follow redirect
    if (
      isRedirect(statusCode) &&
      parsedRedirectTarget !== null &&
      isSuccessful &&
      !isForeignRedirect
    ) {
      if (!redirectTargetIsNew) {
        return true; // redirect target already exists, work is done
      }
      visitedUrls.add(currentUrl);
      redirectChainCount++;
      currentUrl = resolvedLocation!;
      continue;
    }

    // Done — success if terminal and no errors recorded
    return isSuccessful;
  }
}

async function saveRawBody(
  rawBody: Buffer,
  decompressSucceeded: boolean,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<string> {
  const gzipSubdir = decompressSucceeded ? 'gzip' : 'gzip_failed';
  const gzipDir = path.join(outputFolder, 'raw_responses', runId, gzipSubdir);
  const gzipFilePath = nestedIdPath(gzipDir, requestId, 2);
  await fs.promises.mkdir(path.dirname(gzipFilePath), { recursive: true });
  await fs.promises.writeFile(gzipFilePath, rawBody);
  return gzipFilePath;
}

async function saveFinalBody(
  finalBody: Buffer,
  finalAssetPath: string,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(finalAssetPath), { recursive: true });

  // Write final body to tmp location first, then rename to avoid concurrent writes
  const tmpDir = path.join(outputFolder, 'raw_responses', runId, 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, String(requestId));
  await fs.promises.writeFile(tmpPath, finalBody);

  // Rename to final location (skip if already exists - same digest)
  try {
    await fs.promises.rename(tmpPath, finalAssetPath);
    return true;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EEXIST') {
      // File already exists with same digest - just remove tmp
      await fs.promises.unlink(tmpPath).catch(() => {});
      return false;
    } else {
      throw err;
    }
  }
}

async function deleteGeneratedFiles(rawBodyPath: string | null): Promise<void> {
  if (rawBodyPath) {
    await fs.promises.unlink(rawBodyPath).catch(() => {});
  }
}
