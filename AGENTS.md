# Homemade by Bekah

This is the permanent application checkout for `balexander012/Homemade-by-Bekah`. Use the existing repository and keep `main` deployable. Make feature branches and open pull requests. Preserve the product data in Supabase and never copy member data, access tokens, database passwords, or .env files into Git.

## Architecture

- Next.js App Router serves a public application shell. Private reads and writes use the signed-in user’s Supabase token and Row Level Security. Password sign-in has no public signup UI. Provision users and membership through the owner setup.
- `lib/domain.ts` holds validation, date arithmetic, scaling, session transitions and shared types. `lib/plan.ts` derives calendar occurrences and prep checklists. `lib/store.ts` is the shared Supabase persistence boundary. `lib/use-workspace.ts` owns browser caching and optimistic synchronization. Keep application rules shared by the web and integration entry points.
- Recipes have stable IDs and immutable versions. Approvals are separate pointers. A session always references a version ID and a separate target yield. Append a migration for schema changes after merging. Keep workspace scoping in SQL as well as the application.
- Calendar dates and optional local times are Eastern civil time. Treat date-only entries as civil dates. Timers are epoch deadlines. Expiring a timer must never complete a physical step.
- Browser progress uses per-user and per-workspace local storage. Use stable record IDs and optimistic revisions. Preserve pending work during a refresh and show collision resolution if another device changed a queued record. Keep authenticated API and media responses out of the service worker cache.
- Private photo objects use workspace-prefixed paths and authenticated downloads. Receive images through Storage. Store photo metadata in Supabase.
- `/api/mcp` uses stateless Streamable HTTP with OAuth, resource audience, registered client identity and workspace access. `/api/integration` uses an ordinary authenticated Supabase access token. Keep approvals and destructive actions in the app.

## Development and testing

- Use Node.js 22, npm, strict TypeScript, and the committed lockfile. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` before opening a PR.
- Use browser checks at iPad landscape and iPhone sizes for workflow changes. Keep validation and persistence failures visible. Prefer focused tests that cover behavior through the normal entry point.
- Add database regression coverage for policy and migration changes. The PostgreSQL harness runs the migrations with stand-ins for Supabase Auth and Storage. Test hosted Auth, media, OAuth and cross-device behavior against a staging Supabase project before a production release.
- The local demo can use fictional test fixtures and the explicitly unconfirmed historical plan. Never treat historical planning notes as verified recipe instructions or a completed bake.

## Design

The supplied Claude design system is tracked under `brand/` and `public/brand/`. Edit its token source, then run `npm run brand:tokens`. Use its logos, Fraunces, Source Sans 3, light/dark palettes, and touch sizes. Prioritize short step copy, nearby quantities, a visible next action, recoverable check-offs, and the same layout across modes. Use privately uploaded photography for actual products.
