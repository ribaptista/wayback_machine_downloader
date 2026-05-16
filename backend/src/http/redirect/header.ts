import { IncomingHttpHeaders } from '../types';
import { RedirectError } from './types';

function getLocation(headers: IncomingHttpHeaders): string[] {
  const val = headers['location'];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export function resolveLocationHeader(
  statusCode: number,
  headers: IncomingHttpHeaders,
  fromUrl: string,
): string {
  const locationHeaders = getLocation(headers);

  if (locationHeaders.length === 0) {
    throw new RedirectError(
      'redirect_no_location',
      `Redirect response (${statusCode}) missing Location header`,
    );
  }

  if (locationHeaders.length > 1) {
    throw new RedirectError(
      'multiple_location_headers',
      `Multiple Location headers received: ${locationHeaders.join(', ')}`,
    );
  }

  return new URL(locationHeaders[0], fromUrl).toString();
}
