import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, integrationFailure, invoke, isOperation, mcpConfig, operations, type Operation } from "@/lib/integration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await authenticate(request, true);
    const text = await request.text();
    if (text.length > 200000) return new Response("Request too large", { status: 413 });
    const parsed: unknown = JSON.parse(text);
    const server = new McpServer({ name: "Homemade by Bekah", version: "1.0.0" });
    for (const name of Object.keys(operations).filter(isOperation)) {
      if (!context.writable && operations[name].write) continue;
      register(name);
    }
    function register(name: Operation) {
      const tool = operations[name];
      const securitySchemes = [{ type: "oauth2", scopes: ["openid"] }];
      server.registerTool(name, {
        description: tool.description, inputSchema: tool.input,
        annotations: { readOnlyHint: !tool.write, destructiveHint: tool.write, idempotentHint: true, openWorldHint: false },
        _meta: { securitySchemes },
      }, async (input: unknown): Promise<CallToolResult> => {
        try {
          const result = await invoke(context, name, input);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (cause) {
          return { isError: true, content: [{ type: "text", text: integrationFailure(cause).error }] };
        }
      });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request, { parsedBody: parsed });
      const body = await response.text();
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(body || null, { status: response.status, headers });
    } finally {
      await server.close();
    }
  } catch (cause) {
    const { status, error } = integrationFailure(cause);
    const metadata = mcpConfig()?.metadata;
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    if (status === 401 && metadata) headers.set("WWW-Authenticate", `Bearer resource_metadata="${metadata}"`);
    return Response.json({ error }, { status, headers });
  }
}
