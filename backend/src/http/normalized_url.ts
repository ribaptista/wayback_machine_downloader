const URL_REGEX = /^([^\/]+)(\/[^\/]*)*$/;

export function normalizeHost(host: string): string {
  return host.replace(/\.$/, '').replace(/^www[0-9]*\./, '');
}

export function normalizeDomain(domain: string): string {
  return normalizeHost(domain);
}

export class NormalizedUrl {
  private readonly _domain: string;
  private readonly _pathAndQuery: string;

  constructor(url: string) {
    const parsed = new URL(url);
    this._domain = normalizeHost(parsed.hostname);
    this._pathAndQuery = parsed.pathname + parsed.search;
  }

  getNormalizedDomain(): string {
    return this._domain;
  }

  getPathAndQuery(): string {
    return this._pathAndQuery;
  }

  toString(): string {
    return this._domain + this._pathAndQuery;
  }
}

export function equalsOrSubdomain(domain: string, ofDomain: string): boolean {
  return domain === ofDomain || domain.endsWith('.' + ofDomain);
}

export function normalizeUrl(url: string): NormalizedUrl {
  return new NormalizedUrl(url);
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
