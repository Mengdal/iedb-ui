/**
 * Build a base URL from protocol and host, stripping trailing slash.
 */
export function serverBaseUrl(protocol: string, host: string): string {
  return `${protocol}${host}`.replace(/\/$/, '');
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function buildServerUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

export interface ServerFetchOptions extends RequestInit {
  raw?: boolean;
}

/**
 * Low-level fetch helper that builds the server URL, injects the auth token,
 * and defaults Content-Type for JSON payloads. Returns the raw Response so
 * callers can handle status codes, feature gates, and parsing themselves.
 */
export async function serverFetch(
  baseUrl: string,
  path: string,
  options: ServerFetchOptions = {},
  token?: string
): Promise<Response> {
  const url = buildServerUrl(baseUrl, path);
  const headers = new Headers(options.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });
  return res;
}

export interface AiFetchOptions extends ServerFetchOptions {
  apiKey?: string;
}

/**
 * Fetch helper for AI providers. Sets cache: 'no-store' and injects the
 * optional API key as a Bearer token.
 */
export async function aiFetch(baseUrl: string, path: string, options: AiFetchOptions = {}) {
  const { apiKey, ...rest } = options;
  return serverFetch(baseUrl, path, { ...rest, cache: 'no-store' }, apiKey);
}
