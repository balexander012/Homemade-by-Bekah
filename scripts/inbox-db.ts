import { readFile } from "node:fs/promises";
import { Client } from "pg";

// Open a TLS-verified connection with the restricted importer login for this inbox.
// Recipe and photo imports share the recipe importer login; plans use their own.
export async function openImporter(database: string, mode: "recipe" | "plan" | "photo", phase: (name: string) => void) {
  const url = new URL(database);
  const login = mode === "plan" ? /^baking_plan_runner(?:\.[a-z0-9]+)?$/ : /^baking_recipe_runner(?:\.[a-z0-9]+)?$/;
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^(db\.[a-z0-9]+\.supabase\.co|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com)$/.test(url.hostname) ||
      !login.test(decodeURIComponent(url.username))) {
    throw new Error("The database secret must use the designated Supabase importer login.");
  }
  // Requiring TLS here keeps query parameters in the secret from overriding verification.
  phase("TLS trust");
  const ca = await readFile(new URL("./certificates/supabase-root-2021.pem", import.meta.url), "utf8");
  const client = new Client({
    host: url.hostname, port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: "postgres", ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 12000,
    statement_timeout: 20000, application_name: "homemade-baking-inbox",
  });
  phase("database connection");
  await client.connect();
  return client;
}
