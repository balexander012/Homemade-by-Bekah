import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as fallbackPost } from "../app/api/integration/route";
import { POST as mcpPost } from "../app/api/mcp/route";
import { GET as discovery } from "../app/.well-known/oauth-protected-resource/api/mcp/route";

const fixtures = vi.hoisted(() => ({
  issuer: "https://supabase.example.com/auth/v1", audience: "https://bekah.example.com/api/mcp",
  user: "10000000-0000-4000-8000-000000000001", workspace: "20000000-0000-4000-8000-000000000001",
  oauth: "30000000-0000-4000-8000-000000000001", event: "40000000-0000-4000-8000-000000000001",
  rows: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/store")>();
  return { ...actual, supabaseUrl: "https://supabase.example.com", tokenClient: (token: string) => ({
    auth: {
      getClaims: async () => token === "invalid" ? { data: null, error: true } : {
        data: { claims: {
          iss: fixtures.issuer, aud: token === "app" ? "authenticated" : token === "wrong-audience" ? "https://other.example.com" : fixtures.audience,
          sub: fixtures.user, exp: Math.floor(Date.now() / 1000) + 120,
          role: "authenticated", client_id: token === "app" ? undefined : fixtures.oauth, baking_write: token === "write",
        } }, error: null,
      },
    },
    from: (table: string) => {
      const filter: Record<string, unknown> = {};
      let insert: Record<string, unknown> | undefined;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filter[key] = value; return query; },
        order: () => query,
        range: () => query,
        insert: (value: Record<string, unknown>) => { insert = value; return query; },
        single: async () => {
          if (table !== "planner_records" || !insert) throw new Error("Unexpected insert");
          const key = String(insert.id);
          if (fixtures.rows.has(key)) return { data: null, error: { code: "23505" } };
          const data = { ...insert, revision: 0 };
          fixtures.rows.set(key, data);
          return { data, error: null };
        },
        maybeSingle: async () => ({ data: fixtures.rows.get(String(filter.id)) ?? null, error: null }),
        then: (resolve: (result: { data: unknown[]; error: null }) => unknown) => resolve({
          data: table === "workspaces" ? [{ id: fixtures.workspace, name: "Kitchen" }] :
            table === "planner_records" ? [...fixtures.rows.values()] : [],
          error: null,
        }),
      };
      return query;
    },
  }) };
});

const scheduled = {
  title: "Cookie photos", date: "2026-11-27", category: "Product photography",
  status: "Draft", recipes: [], notes: "Recipe pending", recurrence: "None",
};

beforeEach(() => {
  fixtures.rows.clear();
  vi.stubEnv("MCP_RESOURCE_URL", fixtures.audience);
  vi.stubEnv("MCP_OAUTH_CLIENT_ID", fixtures.oauth);
});

function request(path: string, body: unknown, token?: string) {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json, text/event-stream" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request(`https://bekah.example.com${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function rest(tool: string, input: object, token = "app") {
  return fallbackPost(request("/api/integration", { tool, input }, token));
}

function rpc(method: string, params: object, token?: string) {
  return mcpPost(request("/api/mcp", { jsonrpc: "2.0", id: 1, method, params }, token));
}

describe("baking integration", () => {
  it("rejects anonymous, invalid, wrong-audience and cross-workspace calls", async () => {
    expect((await fallbackPost(request("/api/integration", { tool: "list_recipes" }))).status).toBe(401);
    expect((await rest("list_recipes", {}, "invalid")).status).toBe(401);
    expect((await rest("list_recipes", { workspace: fixtures.user })).status).toBe(403);
    expect((await rpc("tools/list", {}, "wrong-audience")).status).toBe(401);
    const anonymous = await rpc("tools/list", {});
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("WWW-Authenticate")).toContain("/.well-known/oauth-protected-resource/api/mcp");
    expect(await discovery().json()).toMatchObject({ resource: fixtures.audience, authorization_servers: [fixtures.issuer] });
  });

  it("saves a date-only draft once and reports duplicates with different payloads", async () => {
    const input = { id: fixtures.event, event: scheduled };
    for (let i = 0; i < 2; i++) expect((await rest("schedule_baking_session", input)).status).toBe(200);
    expect(fixtures.rows.size).toBe(1);
    expect((await rest("schedule_baking_session", { ...input, event: { ...scheduled, date: "2026-02-30" } })).status).toBe(422);
    expect((await rest("schedule_baking_session", { ...input, event: { ...scheduled, title: "Different" } })).status).toBe(409);
    const plan = await (await rest("get_todays_plan", { from: scheduled.date })).json();
    expect(plan.result.events).toHaveLength(1);
    expect(plan.result.events[0].entry.document).not.toHaveProperty("start");
  });

  it("uses the MCP protocol and hides writes for read-only connections", async () => {
    const initial = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } }, "read");
    expect(initial.status).toBe(200);
    expect((await initial.json()).result.serverInfo.name).toBe("Homemade by Bekah");
    const response = await rpc("tools/list", {}, "read");
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result.tools.map((tool: { name: string }) => tool.name)).toContain("get_todays_plan");
    expect(result.tools.map((tool: { name: string }) => tool.name)).not.toContain("schedule_baking_session");
    const save = await rpc("tools/call", { name: "schedule_baking_session", arguments: { id: fixtures.event, event: scheduled } }, "write");
    expect(save.status).toBe(200);
    expect((await save.json()).result.isError).toBeUndefined();
    expect(fixtures.rows.size).toBe(1);
  });
});
