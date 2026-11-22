# Send recipes from ChatGPT to Homemade by Bekah

## What Bekah does

In the **Bekah Baking** project, Bekah works out recipes with ChatGPT. When she is ready she says one of two things:

- **"Put it in the app"** (or "finalize this recipe and add it to my app"). ChatGPT submits the recipe with `"publicationIntent": "publish"`. If the formula is complete and consistent it goes straight into **Recipes → Ready to bake** as the preferred version, and she can start a guided bake or add it to a plan right away. No second approval in the app.
- **"Save this recipe so far."** ChatGPT submits it as a working draft (no `publicationIntent`, or `"draft"`). It keeps unresolved amounts and notes and waits for more work.

If she gives a day to make it ("put it in the app, I want to make it Saturday"), ChatGPT adds a `schedule` with that date. The same submission puts the bake on the calendar, with the recipe attached when it was published.

A recipe that ChatGPT marks for publishing but that still has missing or conflicting details is kept as a draft with the problems listed under **Recipes → Recipes to review**. Nothing is invented to fill a gap. A published recipe is **Ready for Testing** unless Bekah confirms she baked this exact formula, which makes it **Tested**. Putting a recipe in the app says nothing about cottage-food rules.

Paste this prompt into the Bekah Baking project:

> When I ask to find, save, or add a recipe in Homemade by Bekah, use the connected GitHub tools for the private repository `balexander012/Homemade-by-Bekah`. Read `docs/chatgpt-recipe-sync.md`, `recipe-imports/examples/recipe.json` and `recipe-imports/examples/recipe-publish.json` on `main` for the format. When I say to put a recipe in the app, finalize it, or add it to my app, set `"publicationIntent": "publish"` and `"verification": "Finalized"`. When I say to save it so far, leave `publicationIntent` out. Add `tested` only when I say I baked this exact version, with that date. If I name a day to make it, add `schedule` with that date in New York time and any time I gave. Use only the project sources and conversations you can actually access. Preserve my latest explicit decisions and the original source. Never invent a quantity, unit, yield, temperature, timing, instruction, filling, or other detail; list anything missing or conflicting in `issues`. If the recipe states a dough or portion weight, set `portionWeightGrams`. Use the same recipe key for its revisions and a fresh UUID for each submission. Commit one validated JSON file per submission to `recipe-imports/pending/<UUID>.json` on `main`. Change only the inbox files. For a lookup, submit a `kind: "lookup"` request. Reuse the same file and UUID for a retry. Tell me in plain words whether the recipe is now in the app, kept as a draft and why, and whether the bake was added to the calendar. If you can’t read the Baking inbox run, say that processing is pending.

## Recipe JSON

The [draft sample](../recipe-imports/examples/recipe.json) and the [publish sample with a bake date](../recipe-imports/examples/recipe-publish.json) are synthetic test fixtures. Leave them in `examples`.

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
| `publicationIntent` | Optional. `"publish"` when Bekah asks to put the recipe in the app. Leave it out (or use `"draft"`) to save a working draft. |
| `tested` | Optional, publish only. `{ "testedOn": "YYYY-MM-DD", "notes": "..." }` when Bekah confirms she baked this exact formula. Without it the recipe is Ready for Testing. |
| `portionWeightGrams` | Optional. The dough or batter weight per piece when the recipe states one. Publishing checks it against the listed gram weights. |
| `schedule` | Optional. `{ "date": "YYYY-MM-DD", "title": "...", "start": "HH:MM", "end": "HH:MM", "target": 12, "notes": "..." }`. Only `date` is required. Creates a scheduled calendar event. |
| `recipe` | The app’s recipe document from the sample. Always use `"status": "Draft"`. Publishing sets the stored status. |

For a lookup, supply only the header, recipe identity fields and `name`. The run summary returns whether the recipe exists and its UUID on a unique match. It does not disclose the formula.

For a recipe, give each ingredient and step its own UUID. Link steps to the ingredients they use. Use `Work`, `Oven`, `Rest`, or `Cool` for step kind, oven temperatures in Fahrenheit, and confirmed timing in minutes. Keep components such as frosting and filling in the ingredient list and ordered steps with their original names. Put advance requirements in `prep` and confirmed storage in `storage` or `freezer`. Use `changeReason` for the verified differences from the previous formula. Unknown amounts or yields can be `null` in a submission marked `Needs review`. Leave unknown optional temperature, timing, and dates absent.

The initial imports should cover Jumbo Chocolate Chip Cookies, S’mores Cookies, White Chocolate Biscoff Cookies, Cinnamon Rolls, Rosemary Garlic Dutch Oven Bread, Double Chocolate Chip Cookies, and Coffee Cake Cookies where a verified formula is available. The repository sample bakes and historical drafts do not establish those formulas. Separate distinct recipes such as S’mores and Graham Cracker Cookies only when the original sources establish the difference.

## Processing, review, and retries

- **Pending Import** is a new file on `main`. The **Baking inbox** workflow validates the file and its UUID. Invalid documents appear in the workflow summary with field paths when available.
- A **Validated** document is sent to Supabase through a dedicated login with execute permission on its inbox function.
- **Publish:** a complete submission with no issues becomes an immutable version marked **Ready for Testing** (or **Tested** with `tested`) and is made the preferred version. It shows under **Ready to bake** and in **Start baking**. Before publishing, the importer also checks that each step’s timer matches the minutes written in that step, that oven temperatures match the text, and that the gram weights fit `portionWeightGrams` × yield. Any problem keeps it as a draft with the reason.
- **Draft:** a complete, unique submission becomes an immutable **Draft** and appears **Ready for review**. Incomplete submissions appear with their issues and do not add a library version.
- **Schedule:** a `schedule` adds one **Scheduled** event on that date. A published recipe is attached at the requested target; a draft is mentioned in the event notes instead.
- The database checks explicit IDs, stable keys, confirmed aliases, and normalized names across prior versions. Case, spacing, and punctuation differences match. A conflicting identity requires review. Supply confirmed aliases when a name genuinely changes.
- Reusing an import ID with the same payload returns the original result and never adds a second version or event. Reusing it with different content fails. An identical formula using new ingredient or step UUIDs matches the existing version: publishing it again reports **Already in the app**. A changed draft creates a draft on the same recipe and the preferred version stays. A changed published formula becomes the new preferred version; every earlier version is kept.
- **Going back:** open the recipe, pick an earlier ready or tested version under **Version history**, and choose **Make preferred version**.
- **Calendar events:** when a recipe gets a newer preferred version, scheduled events that use the older one show **Use the newer version**. Nothing changes until someone taps it, and the change goes through the normal revision check. Started and completed baking sessions keep the version they were baked with.
- Reviewing in the app is optional. Open **Recipes → Recipes to review** to see drafts. Expand **Compare with the previous version** to see differences. Choose **Approve draft** after testing it, or **Reject draft** to dismiss it while keeping history. If the preferred version changed while a draft awaited review, create a new revision after comparing against the current version.
- See **Actions → Baking inbox → Summary** for each result. For a temporary connection failure, rerun the workflow on `main` with the same import UUID. For corrected data, submit a new file with a new UUID. Remove or move an invalid inbox file after resolving it so subsequent runs can report success. Git history and the database preserve successful receipts.

For recipe photos, see [chatgpt-photo-sync.md](chatgpt-photo-sync.md).

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
