import { getVercelOidcToken } from '@vercel/oidc';

/**
 * Credential for AI Gateway. Prefers an explicit AI_GATEWAY_API_KEY; otherwise falls back to the
 * project's Vercel OIDC token, which AI Gateway also accepts. Host-only: never pass it into a sandbox.
 */
export async function gatewayKey() {
  return process.env.AI_GATEWAY_API_KEY || (await getVercelOidcToken());
}
