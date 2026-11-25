import { apiDocsEnabled } from "@/lib/openapi";

export const dynamic = "force-dynamic";

const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

const page = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Sikligi API</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
  <style>body { margin: 0; background: #fafafa; } .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: window.location.pathname.replace(/\\/$/, "") + "/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      docExpansion: "list",
      defaultModelsExpandDepth: 0,
      persistAuthorization: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;

export function GET() {
  if (!apiDocsEnabled()) return Response.json({ error: "Endpoint tidak ditemukan" }, { status: 404 });
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
