/**
 * Build a base URL from protocol and host, stripping trailing slash.
 */
export function serverBaseUrl(protocol: string, host: string): string {
  return `${protocol}${host}`.replace(/\/$/, '');
}
