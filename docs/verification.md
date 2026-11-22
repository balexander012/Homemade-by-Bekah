# Release verification

## Automated checks

Run `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e`. GitHub Actions runs the same checks.

The local browser suite uses Chromium at iPad landscape and iPhone dimensions. It exercises a three-recipe plan, rescheduling, scaled steps, timer recovery on offline reload, the photo checklist, feedback, and draft revision preservation. The migration suite verifies access controls in PostgreSQL with test Auth and Storage schemas. The MCP route suite runs the real protocol handler with verified-claim and Supabase response fixtures.

## Staging acceptance

Use a staging Supabase project and the HTTPS preview described in [Deployment](deployment.md).

- Sign in with both member accounts and try an uninvited account.
- Plan a bake using three verified recipes, set quantities, move the date, and confirm prep tasks follow.
- On iPad Safari, add the app to the Home Screen. Start a bake and leave a timer running. Disconnect Wi-Fi, reload and complete a step. Reconnect and confirm the second device sees the progress. Make competing edits to check the conflict prompt.
- From an iPhone, upload a photo while the iPad session is open. Check the upload, intended use, retake status and hero selection on both devices. Attempt a download as a nonmember and confirm access is denied.
- Complete the [ChatGPT OAuth setup](integration.md). Save a draft from ChatGPT, repeat the same request UUID, and verify the result in the kitchen calendar. Test a read-only grant and revoke it.
- Verify the original recipe sources before marking any of the sample cookie drafts Ready for Testing.

## Feature limits

Imported website recipes use structured recipe metadata. HTML, text and JSON files can be reviewed in the recipe editor. Screenshot OCR, binary document and video extraction use the manual text or transcript fallback. No image or recipe extraction is assumed accurate without review.

Smart Baking orders eligible steps across recipes and reserves the oven for one timed batch at a time until that step is checked off. Equipment, tray capacity and other resources can be coordinated using the preparation list and oven notes. Tray packing and concurrent use of multiple ovens are not optimized automatically.

The app saves timer deadlines independently of notification delivery. Notifications, sound and screen wake lock depend on the foreground app and browser support. There is no background reminder delivery guarantee.
