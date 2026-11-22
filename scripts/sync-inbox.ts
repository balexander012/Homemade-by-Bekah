import { execFileSync } from "node:child_process";
import { appendFile, lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client } from "pg";
import { planInboxSchema, recipeInboxSchema, reviewIssues } from "../lib/sync-import";

const root = process.env.IMPORT_INBOX_ROOT ?? fileURLToPath(new URL("../", import.meta.url));
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const mode = process.argv[2];
if (mode !== "recipe" && mode !== "plan") throw new Error("Select recipe or plan.");
const folder = mode === "recipe" ? "recipe-imports/pending" : "plan-imports/pending";
const database = process.env.IMPORT_DATABASE_URL?.trim();
const onlyId = process.env.IMPORT_ONLY_ID;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (onlyId && !idPattern.test(onlyId)) throw new Error("Provide a lowercase import UUID.");

async function run() {
  const lines = ["# Baking inbox", "", "| Import ID | Result | Recipe ID | Version ID | Record revision |", "| --- | --- | --- | --- | --- |"];
  const files = git("ls-files", "-z", "--", folder).split("\0").filter((path) => path.endsWith(".json"));
  const selected = onlyId ? files.filter((path) => path === `${folder}/${onlyId}.json`) : files;
  if (onlyId && !selected.length) throw new Error("No tracked import file matches the requested UUID.");
  const pending: { id: string; payload: string; issues: string[]; sha: string }[] = [];
  let failures = 0;

  for (const path of selected) {
    const id = path.slice(folder.length + 1, -5);
    if (!idPattern.test(id)) { failures++; lines.push("| — | Invalid filename | — | — | — |"); continue; }
    try {
      const fullPath = resolve(root, path);
      const stat = await lstat(fullPath);
      if (!stat.isFile() || stat.size > 120000) throw new Error("The file exceeds the size limit or is not a regular file.");
      const raw: unknown = JSON.parse(await readFile(fullPath, "utf8"));
      const value = (mode === "recipe" ? recipeInboxSchema : planInboxSchema).parse(raw);
      if (value.importId !== id) throw new Error("Filename and import ID disagree.");
      const issues = value.kind === "recipe" ? reviewIssues(value) : [];
      pending.push({ id, payload: JSON.stringify(value), issues, sha: git("log", "-1", "--format=%H", "--", path).trim() });
    } catch (error) {
      failures++;
      const field = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
        ? error.issues.slice(0, 8).map((item) => item.path.map(String).join(".")).join(", ").replace(/[^\w., ]/g, "").slice(0, 200) : "";
      lines.push(`| ${id} | Invalid JSON or schema${field ? ` (${field})` : ""} | — | — | — |`);
    }
  }

  async function writeSummary() {
    if (selected.length === 0) lines.push("| — | No imports | — | — | — |");
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
    else process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (!pending.length) {
    await writeSummary();
    if (failures) process.exitCode = 1;
    return;
  }
  if (!database) {
    for (const entry of pending) lines.push(`| ${entry.id} | Validated. Database credential missing | — | — | — |`);
    await writeSummary();
    process.exitCode = 1;
    return;
  }

  let client: Client | undefined;
  let phase = "connection URL";
  try {
    const url = new URL(database);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !/^(db\.[a-z0-9]+\.supabase\.co|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com)$/.test(url.hostname) ||
        !(mode === "recipe" ? /^baking_recipe_runner(?:\.[a-z0-9]+)?$/ : /^baking_plan_runner(?:\.[a-z0-9]+)?$/).test(decodeURIComponent(url.username))) {
      throw new Error("The database secret must use the designated Supabase importer login.");
    }
    // Requiring TLS here keeps query parameters in the secret from overriding verification.
    phase = "TLS trust";
    const ca = await readFile(new URL("./certificates/supabase-root-2021.pem", import.meta.url), "utf8");
    client = new Client({
      host: url.hostname, port: url.port ? Number(url.port) : 5432,
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: "postgres", ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 12000,
      statement_timeout: 20000, application_name: "homemade-baking-inbox",
    });
    phase = "database connection";
    await client.connect();
    const labels: Record<string,string> = {
      incomplete: "Needs review", ready_for_review: "Draft ready for review", already_exists: "Matching version already exists",
      approved: "Previously approved", rejected: "Previously rejected", found: "Recipe found",
      not_found: "No matching recipe", saved: "Saved",
    };
    for (const entry of pending) {
      try {
        const response = mode === "recipe"
          ? await client.query("select baking_import.submit_recipe($1::jsonb,$2::text[],$3::text) as result", [entry.payload, entry.issues, entry.sha])
          : await client.query("select baking_import.submit_plan($1::jsonb,$2::text) as result", [entry.payload, entry.sha]);
        const result = response.rows[0].result;
        const label = labels[result.status] ?? "Unknown status";
        lines.push(`| ${entry.id} | ${label}${result.replayed ? " (replayed)" : ""} | ${result.recipeId ?? "—"} | ${result.versionId ?? "—"} | ${result.revision ?? "—"} |`);
      } catch (error) {
        failures++;
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        lines.push(`| ${entry.id} | Database rejected import${/^[A-Z0-9]{5}$/.test(code) ? ` (${code})` : ""} | — | — | — |`);
      }
    }
  } catch (error) {
    failures++;
    const rawCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const code = /^[A-Z0-9_]{3,50}$/.test(rawCode) ? ` (${rawCode})` : "";
    const detail = `Could not open ${phase}${code}`;
    process.stderr.write(`${detail}. Check the importer configuration.\n`);
    for (const entry of pending) lines.push(`| ${entry.id} | Validated. ${detail} | — | — | — |`);
  } finally {
    try { await client?.end(); } catch { /* The connection may have failed before opening. */ }
    await writeSummary();
  }
  if (failures) process.exitCode = 1;
}

void run().catch(() => { process.stderr.write("Import runner could not finish. Check inbox configuration.\n"); process.exitCode = 1; });
