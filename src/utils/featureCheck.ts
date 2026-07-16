/**
 * Detects the specific "feature not enabled" error pattern returned by the server
 * when an auth/RBAC module is not configured.
 *
 * The server returns HTTP 404 with an error body like:
 *   { "error": "Cannot GET /api/v1/auth/tokens" }
 * when the route doesn't exist because the feature is disabled in config.
 *
 * @param status   HTTP response status code
 * @param errorMsg The `error` field from the response body
 * @returns true when the response indicates a disabled/unconfigured feature
 */
export function isFeatureNotEnabled(status: number, errorMsg: string): boolean {
  return status === 404 && errorMsg.includes('Cannot GET')
}
