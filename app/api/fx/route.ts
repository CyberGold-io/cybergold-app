import { backendRoute } from "@/app/server/backend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = backendRoute("/api/fx");

// The former production-cached FX route returns this response for every
// supported non-read method. Keep it while cache ownership moves to backend.
function methodNotAllowed() {
  return new Response(new TextEncoder().encode("Method Not Allowed"), {
    status: 405, headers: { Allow: "GET, HEAD" },
  });
}
export const OPTIONS = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
