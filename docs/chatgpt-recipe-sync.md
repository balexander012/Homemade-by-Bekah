# Send recipes from ChatGPT to Homemade by Bekah

## What Bekah does

In the **Bekah Baking** project, ask ChatGPT to save a finalized recipe. ChatGPT uses its existing GitHub connection to submit one JSON file per recipe to the private repository. The app shows complete imports under **Recipes → Recipes to review**. Nothing is automatically approved. This flow does not depend on the MCP connection.

Paste this prompt into the Bekah Baking project:

> When I ask to find, save, or update a recipe in Homemade by Bekah, use the connected GitHub tools for the private repository `balexander012/Homemade-by-Bekah`. Read `docs/chatgpt-recipe-sync.md` and `recipe-imports/examples/recipe.json` on `main` for the format. Use only the project sources and conversations you can actually access. Preserve Bekah’s latest explicit decisions and the original source. Never invent a quantity, unit, yield, temperature, timing, instruction, filling, or other detail. Use the same recipe key for its revisions and a fresh UUID for each submission. Commit one validated JSON file per submission to `recipe-imports/pending/<UUID>.json` on `main`. Change only the inbox files. If a direct inbox commit is unavailable, open a pull request containing only those files. For a lookup, submit a `kind: "lookup"` request. Reuse the same file and UUID for a retry. Report the GitHub links and any uncertainty. Say whether GitHub accepted the submission or the Baking inbox run confirmed a draft. If you can’t read the run, say that processing is pending.

## Recipe JSON

The [complete machine-readable sample](../recipe-imports/examples/recipe.json) is a synthetic test fixture. Leave it in `examples`.

| Field | Use |
| --- | --- |
| `schemaVersion` | The number `1`. |
| `kind` | `recipe` to submit a formula or `lookup` to check identity. |
| `importId` | A lowercase UUID. The filename is the same UUID with `.json` appended. |
| `recipeKey` | Stable lowercase hyphenated key, such as `white-chocolate-biscoff-cookies`. Reuse it when updating the same recipe. |
| `aliases` | Optional list of confirmed alternate names for that same recipe. |
| `sourceKey` | Optional stable key for a single recipe in its original source. Avoid a shared key for a book or an entire project. |
| `existingRecipeId` | Optional confirmed application recipe UUID. Use the UUID returned by a prior import or lookup. |
| `finalizedOn` | Optional confirmed calendar date in YYYY-MM-DD format. |
| `verification` | `Finalized` for an explicitly confirmed formula or `Needs review` for an incomplete submission requiring follow-up. |
| `sourceReferences` | At least one source reference. Include a conversation title, date, message reference, file name, page, or URL where available. |
| `issues` | A list of missing details or conflicts. Use an empty list only for an unambiguous recipe. |
| `recipe` | The app’s recipe document from the sample. Always use `"status": "Draft"`. |

For a lookup, supply only the header, recipe identity fields and `name`. The run summary returns whether the recipe exists and its UUID on a unique match. It does not disclose the formula.

For a recipe, give each ingredient and step its own UUID. Link steps to the ingredients they use. Use `Work`, `Oven`, `Rest`, or `Cool` for step kind, oven temperatures in Fahrenheit, and confirmed timing in minutes. Keep components such as frosting and filling in the ingredient list and ordered steps with their original names. Put advance requirements in `prep` and confirmed storage in `storage` or `freezer`. Use `changeReason` for the verified differences from the previous formula. Unknown amounts or yields can be `null` in a submission marked `Needs review`. Leave unknown optional temperature, timing, and dates absent.

The initial imports should cover Jumbo Chocolate Chip Cookies, S’mores Cookies, White Chocolate Biscoff Cookies, Cinnamon Rolls, Rosemary Garlic Dutch Oven Bread, Double Chocolate Chip Cookies, and Coffee Cake Cookies where a verified formula is available. The repository sample bakes and historical drafts do not establish those formulas. Separate distinct recipes such as S’mores and Graham Cracker Cookies only when the original sources establish the difference.

## Processing, review, and retries

- **Pending Import** is a new file on `main`. The **Baking inbox** workflow validates the file and its UUID. Invalid documents appear in the workflow summary with field paths when available.
- A **Validated** document is sent to Supabase through a dedicated login with execute permission on its inbox function. A complete, unique submission becomes an immutable **Draft** and appears **Ready for review**. Incomplete submissions appear with their issues and do not add a library version.
- The database checks explicit IDs, stable keys, confirmed aliases, and normalized names across prior versions. Case, spacing, and punctuation differences match. A conflicting identity requires review. Supply confirmed aliases when a name genuinely changes.
- Reusing an import ID with the same payload returns the original result. Reusing it with different content fails. An identical formula using new ingredient or step UUIDs matches the existing version. A changed formula creates a draft on the same recipe. The current approved version stays preferred.
- In the app, open **Recipes → Recipes to review**. Expand **Compare with the previous version** to see differences. Choose **Approve draft** only after confirming you tested it, or **Reject draft** to dismiss it while keeping history. If the preferred version changed while a draft awaited review, create a new revision after comparing against the current version.
- See **Actions → Baking inbox → Summary** for each result. For a temporary connection failure, rerun the workflow on `main` with the same import UUID. For corrected data, submit a new file with a new UUID. Remove or move an invalid inbox file after resolving it so subsequent runs can report success. Git history and the database preserve successful receipts.

## Calendar and Today’s Plan

The independent `plan-imports/pending/<UUID>.json` inbox accepts a version-1 envelope containing `importId`, `recordId`, and `kind` with exactly one matching body property.

- For `kind: "event"`, give `event` a title, confirmed Eastern date, category, `"status": "Scheduled"`, `recipes`, notes, recurrence, and optional confirmed times. Each recipe assignment is `{ "versionId": "...", "target": 6 }` or has a `null` target. Resolve relative dates in America/New_York. Leave `start` and `end` absent when Bekah supplied no time.
- For a calendar update, use the existing `recordId`, a new `importId`, and the last known `expectedRevision`. The run summary returns the resulting revision. Ask for the exact record when you can’t identify it. Keep cancellations and recipe approval in the app.
- For `kind: "task"`, use a `task` with title, date, `"status": "Open"`, `"section": "Preparation"`, and optional linked `eventId`.
- For `kind: "idea"`, use `idea` with name, description, category, link, notes, priority, `"status": "Idea"`, and optional target date.

New records use a stable `recordId` for retries. Existing event updates use a revision check. Active kitchen sessions are started from the scheduled calendar event inside the app.

## One-time connection and revocation

Apply `202611220004_chatgpt_recipe_sync.sql` first. In Supabase, verify there is exactly one intended workspace and configure the import destination.

```sql
insert into baking_import.configuration (kind, workspace_id)
select choice.kind, w.id
from public.workspaces w
cross join (values ('recipe'), ('plan')) as choice(kind)
where w.name = 'Homemade by Bekah';
```

The migration creates `baking_recipe_runner` and `baking_plan_runner` as `NOLOGIN`. An owner enables each requested login with a different strong password in a private database client. For example, use a trusted SQL connection and enable `LOGIN`, then use psql’s interactive `\password baking_recipe_runner` and `\password baking_plan_runner` commands. A password typed into a SQL query can be captured in query history, so use the interactive password command.

In the repository’s **Settings → Secrets and variables → Actions**, save one TLS database URI as `SUPABASE_RECIPE_IMPORT_DATABASE_URL` and the other as `SUPABASE_PLAN_IMPORT_DATABASE_URL`. Use the Supabase **Connect → Session pooler** hostname and port with `baking_recipe_runner.PROJECT_REF` or `baking_plan_runner.PROJECT_REF` as the username. URL-encode the password and keep the database name `postgres`. Use the corresponding restricted login, never the project owner or service-role credentials. Neither secret belongs in Vercel, the inbox, a commit, or a chat. The runner verifies the server hostname and TLS chain using the public Supabase Root 2021 CA bundled under `scripts/certificates/`. Replace that certificate with the official Dashboard download and update the workflow’s pinned runner commit if Supabase rotates it.

To suspend an inbox, set its role to `NOLOGIN`, remove its GitHub Actions secret, and terminate existing runner connections if necessary. Rotate the dedicated credential independently of Supabase Auth and the other inbox. Existing recipes and approvals stay in the library. The existing MCP routes and authorization are independent.
