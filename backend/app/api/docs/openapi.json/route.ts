import { apiDocsEnabled, openApiDocument } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export function GET() {
  if (!apiDocsEnabled()) return Response.json({ error: "Endpoint tidak ditemukan" }, { status: 404 });
  return Response.json(openApiDocument, { headers: { "Cache-Control": "no-store" } });
}
