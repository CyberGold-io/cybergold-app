import { backendRoute } from "@/app/server/backend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = backendRoute("/api/quotes/basket-preview");
