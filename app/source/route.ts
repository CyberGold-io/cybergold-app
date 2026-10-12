// SPDX-License-Identifier: AGPL-3.0-only
import { serverEnv } from "../server/environment.ts";
import { sourcePage } from "../utils/sourceOffer.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const page = await sourcePage(process.env.NEXT_PUBLIC_CYBERGOLD_APP_COMMIT, async () => {
    const headers = new Headers();
    if (serverEnv.CYBERGOLD_BACKEND_BEARER_TOKEN) headers.set("Authorization", `Bearer ${serverEnv.CYBERGOLD_BACKEND_BEARER_TOKEN}`);
    const response = await fetch(new URL("/source", serverEnv.CYBERGOLD_BACKEND_URL),
      { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Backend source information unavailable");
    return response.json();
  });
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
