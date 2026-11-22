import { mcpConfig } from "@/lib/integration";

export function GET() {
  const config = mcpConfig();
  if (!config) return new Response(null, { status: 404 });
  return Response.json({
    resource: config.resource, resource_name: "Homemade by Bekah", authorization_servers: [config.issuer],
    scopes_supported: ["openid"], bearer_methods_supported: ["header"],
  }, { headers: { "Cache-Control": "no-store" } });
}
