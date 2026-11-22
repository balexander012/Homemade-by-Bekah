import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeVersions, addDays, canBake, date, easternDate, eventSchema, feedbackSchema, ideaSchema, modes, recipeSchema, selectionSchema, taskSchema, uuid } from "./domain";
import { planTasks, upcoming } from "./plan";
import { ConflictError, loadWorkspace, recordsOf, saveRecord, saveVersion, supabaseUrl, tokenClient } from "./store";

export class IntegrationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function mcpConfig() {
  const resource = process.env.MCP_RESOURCE_URL;
  const clientId = uuid.safeParse(process.env.MCP_OAUTH_CLIENT_ID);
  if (!supabaseUrl || !resource || !/^https:\/\/[^/?#]+\/api\/mcp$/.test(resource) || !clientId.success) return null;
  return { resource, clientId: String(clientId.data), issuer: `${supabaseUrl.replace(/\/$/, "")}/auth/v1`, metadata: new URL("/.well-known/oauth-protected-resource/api/mcp", resource).href };
}

export async function authenticate(request: Request, oauth: boolean) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
  const config = oauth ? mcpConfig() : null;
  if (oauth && !config) throw new IntegrationError("Configure the ChatGPT connection first.", 503);
  if (!token) throw new IntegrationError("Valid authorization is required.", 401);
  const client = tokenClient(token);
  const { data, error } = await client.auth.getClaims(token);
  const claims = data?.claims;
  const issuer = `${supabaseUrl!.replace(/\/$/, "")}/auth/v1`;
  if (error || !claims || claims.iss !== issuer || claims.role !== "authenticated" || !uuid.safeParse(claims.sub).success ||
      !claims.exp || claims.exp * 1000 <= Date.now() || (typeof claims.nbf === "number" && claims.nbf * 1000 > Date.now())) {
    throw new IntegrationError("Valid authorization is required.", 401);
  }
  const claimClient = claims.client_id;
  if (oauth ? (claims.aud !== config?.resource || claimClient !== config?.clientId) : (claims.aud !== "authenticated" || claimClient != null)) {
    throw new IntegrationError("This token is not authorized for this endpoint.", 401);
  }
  const workspaces = await client.from("workspaces").select("id,name").order("name");
  if (workspaces.error) throw new IntegrationError("Workspace access could not be verified.", 503);
  if (!workspaces.data?.length) throw new IntegrationError("Workspace access is required.", 403);
  return { client, workspaces: workspaces.data as { id: string; name: string }[], writable: !oauth || claims.baking_write === true };
}

type Context = { client: SupabaseClient; workspaces: { id: string; name: string }[]; writable: boolean };
const span = { workspace: uuid.optional(), from: date.optional(), days: z.number().int().min(1).max(31).optional() };
const workspace = { workspace: uuid.optional() };
const revision = { id: uuid, revision: z.number().int().nonnegative() };
const entityId = { id: uuid };
const createVersion = { id: uuid, recipeId: uuid, recipe: recipeSchema };
export const operations = {
  list_recipes: { description: "List preferred recipe versions and their readiness.", input: z.object({ ...workspace, query: z.string().max(200).optional() }), write: false },
  get_recipe: { description: "Read a specific recipe version, including verified measurements and instructions.", input: z.object({ ...workspace, ...entityId }), write: false },
  get_recipe_versions: { description: "Read revision history using the recipe ID, excluding unrelated recipes.", input: z.object({ ...workspace, ...entityId }), write: false },
  list_recipe_ideas: { description: "List saved product ideas.", input: z.object(workspace), write: false },
  get_calendar_events: { description: "Read calendar events for a date range in America/New_York.", input: z.object(span), write: false },
  get_todays_plan: { description: "Read the plan, calendar, preparation tasks and active sessions for a date in America/New_York.", input: z.object({ ...workspace, from: date.optional() }), write: false },
  get_upcoming_sessions: { description: "List saved baking sessions from a date.", input: z.object(span), write: false },
  get_session_status: { description: "Read saved status and progress for a baking session.", input: z.object({ ...workspace, ...entityId }), write: false },
  get_preparation_tasks: { description: "Read preparation tasks for a date interval.", input: z.object(span), write: false },
  create_recipe_draft: { description: "Create a recipe draft. Use fresh UUIDs for id and recipeId. Reuse both on retry. Preserve missing values.", input: z.object({ ...workspace, ...createVersion }), write: true },
  update_recipe_draft: { description: "Save an immutable draft revision for an existing recipe. Use a fresh version id and reuse it on retry.", input: z.object({ ...workspace, ...createVersion }), write: true },
  create_recipe_idea: { description: "Create an idea. Reuse the same id on retries.", input: z.object({ ...workspace, ...entityId, idea: ideaSchema }), write: true },
  schedule_baking_session: { description: "Create a calendar event. Resolve a confirmed date in America/New_York. Leave unknown times empty. Use Draft for unresolved recipes or plans. Reuse the same id on retries.", input: z.object({ ...workspace, ...entityId, event: eventSchema }), write: true },
  update_calendar_event: { description: "Update a calendar event, including rescheduling. Supply its current revision. Cancellation and completion are managed in the baking app.", input: z.object({ ...workspace, ...revision, event: eventSchema }), write: true },
  update_baking_session: { description: "Update the name or mode of an active baking session. Supply the current revision.", input: z.object({ ...workspace, ...revision, title: z.string().trim().min(1).max(200).optional(), mode: z.enum(modes).optional() }), write: true },
  attach_recipe_to_session: { description: "Attach a verified baking-ready recipe version to an active session.", input: z.object({ ...workspace, ...revision, selection: selectionSchema }), write: true },
  create_preparation_task: { description: "Create an open preparation task. Reuse the same id on retries.", input: z.object({ ...workspace, ...entityId, task: taskSchema }), write: true },
  update_task_status: { description: "Check off or reopen a task after the user confirms its real-world status.", input: z.object({ ...workspace, ...revision, from: date.optional(), status: z.enum(["Open", "Done"]) }), write: true },
  record_baking_feedback: { description: "Record user-provided baking notes for a recipe in a session.", input: z.object({ ...workspace, ...revision, versionId: uuid, feedback: feedbackSchema }), write: true },
} as const;
export type Operation = keyof typeof operations;

export function isOperation(value: string): value is Operation { return Object.hasOwn(operations, value); }

export async function invoke<K extends Operation>(context: Context, name: K, raw: unknown): Promise<unknown> {
  const tool = operations[name];
  if (tool.write && !context.writable) throw new IntegrationError("This connection has read-only access.", 403);
  const input = tool.input.parse(raw) as z.output<(typeof operations)[K]["input"]>;
  const chosen = input.workspace ?? (context.workspaces.length === 1 ? context.workspaces[0].id : undefined);
  if (!chosen || !context.workspaces.some((item) => item.id === chosen)) throw new IntegrationError("Select an authorized workspace.", 403);
  return run(context.client, chosen, name, input);
}

type Input<K extends Operation> = z.output<(typeof operations)[K]["input"]>;
async function run(client: SupabaseClient, workspaceId: string, name: Operation, input: Input<Operation>) {
  const { records, library } = await loadWorkspace(client, workspaceId);
  const events = recordsOf(records, "event");
  const tasks = recordsOf(records, "task");
  const sessions = recordsOf(records, "session");
  const from = ("from" in input ? input.from : undefined) ?? easternDate();
  const days = ("days" in input ? input.days : undefined) ?? 7;
  const notFound = () => new IntegrationError("The requested record was not found.", 404);
  const find = <T extends { id: string }>(list: T[], id: string) => {
    const item = list.find((item) => item.id === id);
    if (!item) throw notFound();
    return item;
  };
  const checkSelections = (list: { versionId: string }[]) => list.forEach(({ versionId }) => find(library.versions, versionId));
  switch (name) {
    case "list_recipes": {
      const query = (input as Input<"list_recipes">).query?.toLowerCase() ?? "";
      return activeVersions(library).filter(({ document }) => document.name.toLowerCase().includes(query))
        .map(({ id, recipe_id, document }) => ({ id, recipeId: recipe_id, name: document.name, category: document.category,
          status: library.approvals[recipe_id] === id ? "Approved" : document.status, yield: document.yieldLow, yieldUnit: document.yieldUnit }));
    }
    case "get_recipe": return find(library.versions, (input as Input<"get_recipe">).id);
    case "get_recipe_versions": return library.versions.filter((item) => item.recipe_id === (input as Input<"get_recipe_versions">).id);
    case "list_recipe_ideas": return recordsOf(records, "idea");
    case "get_calendar_events": return upcoming(events, from, days);
    case "get_todays_plan": return {
      date: from, events: upcoming(events, from, 1), tasks: (await planTasks(events, tasks, library.versions, from, 2)).filter((item) => item.document.status !== "Dismissed"),
      active: sessions.filter((item) => item.document.status === "Active"),
    };
    case "get_upcoming_sessions": return sessions.filter(({ document }) => document.date >= from && document.date < addDays(from, days));
    case "get_session_status": return find(sessions, (input as Input<"get_session_status">).id);
    case "get_preparation_tasks": return (await planTasks(events, tasks, library.versions, from, days)).filter((item) => item.document.section === "Preparation" && item.document.status !== "Dismissed");
    case "create_recipe_draft":
    case "update_recipe_draft": {
      const { id, recipeId, recipe } = input as Input<"create_recipe_draft">;
      const existing = library.versions.some((version) => version.recipe_id === recipeId);
      if (name === "update_recipe_draft" && !existing) throw notFound();
      if (name === "create_recipe_draft" && existing && !library.versions.some((version) => version.recipe_id === recipeId && version.id === id)) {
        throw new ConflictError("That recipe identifier is already in use.");
      }
      await saveVersion(client, workspaceId, recipeId, id, { ...recipe, status: "Draft" });
      return { id, recipeId };
    }
    case "create_recipe_idea": {
      const { id, idea } = input as Input<"create_recipe_idea">;
      return saveRecord(client, workspaceId, { id, kind: "idea", document: idea, revision: 0 }, null);
    }
    case "schedule_baking_session":
    case "update_calendar_event": {
      const { id, event } = input as Input<"schedule_baking_session">;
      if (event.status === "Cancelled" || event.status === "Completed") throw new IntegrationError("Manage cancellation and completion in the baking app.", 403);
      checkSelections(event.recipes);
      const base = name === "update_calendar_event" ? (input as Input<"update_calendar_event">).revision : null;
      if (base !== null) {
        const existing = find(events, id);
        if (existing.document.status === "Cancelled" || existing.document.status === "Completed" ||
            existing.document.excludedDates.join() !== event.excludedDates.join()) throw new IntegrationError("Manage cancellations and completed events in the baking app.", 403);
      } else if (event.excludedDates.length) throw new IntegrationError("Manage cancellations in the baking app.", 403);
      return saveRecord(client, workspaceId, { id, kind: "event", document: event, revision: base ?? 0 }, base);
    }
    case "update_baking_session":
    case "attach_recipe_to_session":
    case "record_baking_feedback": {
      const { id, revision: base } = input as Input<"update_baking_session">;
      const entry = find(sessions, id);
      const session = entry.document;
      if (name === "record_baking_feedback") {
        const { versionId, feedback } = input as Input<"record_baking_feedback">;
        if (!session.recipes.some((item) => item.versionId === versionId)) throw notFound();
        return saveRecord(client, workspaceId, { ...entry, document: { ...session, feedback: { ...session.feedback, [versionId]: feedback } } }, base);
      }
      if (session.status !== "Active") throw new IntegrationError("This baking session is already complete.", 409);
      if (name === "attach_recipe_to_session") {
        const { selection } = input as Input<"attach_recipe_to_session">;
        const version = find(library.versions, selection.versionId);
        if (!canBake(version.document) || !["Ready for Testing", "Tested"].includes(version.document.status)) throw new IntegrationError("The recipe must be ready for baking.", 422);
        const existing = session.recipes.find((item) => item.versionId === selection.versionId);
        if (existing && existing.target !== selection.target) throw new ConflictError("This version is already attached with a different batch size.");
        return saveRecord(client, workspaceId, { ...entry, document: { ...session,
          recipes: existing ? session.recipes : [...session.recipes, { ...selection, completed: [] }] } }, base);
      }
      const { title, mode } = input as Input<"update_baking_session">;
      return saveRecord(client, workspaceId, { ...entry, document: { ...session, title: title ?? session.title, mode: mode ?? session.mode } }, base);
    }
    case "create_preparation_task": {
      const { id, task } = input as Input<"create_preparation_task">;
      if (task.eventId) find(events, task.eventId);
      return saveRecord(client, workspaceId, { id, kind: "task", document: { ...task, section: "Preparation", status: "Open" }, revision: 0 }, null);
    }
    case "update_task_status": {
      const { id, revision: base, status } = input as Input<"update_task_status">;
      const saved = tasks.find((item) => item.id === id);
      const entry = saved ?? find(await planTasks(events, [], library.versions, from, 31), id);
      return saveRecord(client, workspaceId, { ...entry, document: { ...entry.document, status } }, saved ? base : null);
    }
  }
}

export function integrationFailure(cause: unknown): { status: number; error: string } {
  if (cause instanceof IntegrationError) return { status: cause.status, error: cause.message };
  if (cause instanceof z.ZodError) return { status: 422, error: cause.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join(" ") };
  if (cause instanceof ConflictError) return { status: 409, error: cause.message };
  if (cause instanceof SyntaxError) return { status: 400, error: "Enter a valid JSON request." };
  return { status: 503, error: "The baking workspace could not complete the request." };
}
