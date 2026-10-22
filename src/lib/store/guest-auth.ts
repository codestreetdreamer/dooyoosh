/**
 * Single place that decides HOW the guest access token is sent to token-protected endpoints
 * (checkoutStatus, getOrder). Contract v0.5 (main 12599c0): `Authorization: Bearer <accessToken>` ONLY;
 * a `?token=` query returns 400. The token is never put in any URL.
 */
export function guestAuth(accessToken: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}
