const URL_REGEX = /^([^\/]+)(\/[^\/]*)*$/;

export function normalizeHost(host: string): string {
  return host.replace(/\.$/, '').replace(/^www[0-9]*\./, '');
}

export function normalizeDomain(domain: string): string {
  return normalizeHost(domain);
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  const host = normalizeHost(parsed.hostname);
  const pathAndQuery = parsed.pathname + parsed.search;
  return host + pathAndQuery;
}

export function getPathParts(original: string): string[] {
  const matches = URL_REGEX.exec(original);
  if (!matches) {
    throw new Error(`URL does not match expected pattern: ${original}`);
  }
  const base = matches[1];
  const pathSuffix = original.slice(base.length);
  if (pathSuffix === '') return [base];
  const qIdx = pathSuffix.indexOf('?');
  const pathPart = qIdx === -1 ? pathSuffix : pathSuffix.slice(0, qIdx);
  const queryPart = qIdx === -1 ? '' : pathSuffix.slice(qIdx); // includes leading '?'
  const segments = pathPart
    .split('/')
    .slice(1)
    .map((s) => '/' + s);
  if (queryPart !== '' && segments.length > 0) {
    segments[segments.length - 1] += queryPart;
  }
  return [base, ...segments];
}
