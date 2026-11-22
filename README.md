# Homemade by Bekah

A private iPad-first workspace for recipes, planning, multi-recipe baking, timers, photos, and test-bake notes.

[Production address](https://homemade-by-bekah.vercel.app)

## Run the application

Use Node.js 22 and npm.

```sh
git clone https://github.com/balexander012/Homemade-by-Bekah.git
cd Homemade-by-Bekah
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Fill in the two Supabase variables in `.env.local` to sign in. For a browser-only walkthrough, leave the Supabase values empty and set `NEXT_PUBLIC_LOCAL_DEMO=1`. The demo saves to that browser and includes the unconfirmed November 22, 2026 cookie plan. Create a verified recipe or use the test suite for a guided-baking walkthrough. Keep demo mode disabled on Vercel.

- [Deployment, user provisioning, and iPad installation](docs/deployment.md)
- [ChatGPT OAuth and authenticated fallback API](docs/integration.md)
- [Development and architecture](AGENTS.md)
- [Verification and release acceptance](docs/verification.md)

## Verify changes

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite builds in local demo mode on port 3100. The PostgreSQL suite applies the actual migrations with a test Auth and Storage schema. A staging Supabase project is needed to verify actual sign-in, storage uploads, two-device synchronization, and the ChatGPT OAuth handshake.

## Design system

The Claude kit’s token source, component CSS and iPad specification are in `brand/`. Logos and font files are in `public/brand/`. Run `npm run brand:tokens` after replacing the token JSON. The manifest and iOS touch icon use square PNG exports of the kit’s app mark. Export 180, 192, 512 and 1024 px PNGs if the mark changes.
