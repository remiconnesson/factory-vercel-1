import { repoFull } from '@/lib/config';

// Liveness endpoint: public, unauthenticated, never cached. Keep imports light (no workflow modules).

// Never prerender or cache: evaluate on every request.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, repo: repoFull }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

const methodNotAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });

// HEAD and OPTIONS must be exported explicitly: otherwise Next auto-implements HEAD via GET (200)
// and OPTIONS as a 204, which would break the "only GET is allowed" contract.
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
// Next would already 405 these, but without the Allow header.
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
