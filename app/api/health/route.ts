import { repoFull } from '@/lib/config';

// Never prerender at build time: the response must reflect the deployment's env vars.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, repo: repoFull }, { headers: { 'Cache-Control': 'no-store' } });
}

// Explicit handlers: Next would otherwise auto-implement HEAD (as GET) and OPTIONS (204),
// and its built-in 405 carries no Allow header.
const methodNotAllowed = () => new Response(null, { status: 405, headers: { Allow: 'GET' } });

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
