# Deploy the private baking workspace

## GitHub

Use the existing [private repository](https://github.com/balexander012/Homemade-by-Bekah). Clone it with credentials for the account that has access. Base feature branches on `main` and use pull requests. Configure a branch protection rule or ruleset for `main` that requires the `verify` job after the first run if the GitHub plan supports private-repository rules. Keep production deployments tied to `main`.

## Supabase

1. Create a Supabase project, ideally with a separate project for testing. Keep the database password in a password manager.
2. Authenticate through the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then run `supabase link --project-ref YOUR_PROJECT_REF` followed by `supabase db push` from this checkout. This installs the relational tables, policies, revision checks, audit log, and private `baking-photos` bucket.
3. Under Authentication, enable email/password sign-in and disable signup. Use **Authentication → Users → Add user** to create Bekah and the administrator with individually assigned credentials. Copy their user IDs after creation. Deliver passwords privately.
4. Create the workspace and memberships in the project SQL editor. Replace the three example UUIDs before running.

```sql
begin;
insert into public.workspaces (id, name)
values ('11111111-1111-4111-8111-111111111111', 'Homemade by Bekah');
insert into public.workspace_members (workspace_id, user_id, role)
values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'baker'),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'admin');
commit;
```

The owner manages account membership in Supabase. Both roles can manage the kitchen records and photos. To add an authorized person, create their account and add a membership for that workspace.

5. Optional example data. In `supabase/example-data.sql`, replace the zero workspace UUID and run the script in the SQL editor. Use it once for the intended workspace. This adds ideas and four reference drafts for the November 22, 2026 photography plan. The sample contains no invented measurements or steps.
6. In the project **Connect** dialog or API settings, copy the project URL and the publishable key. These two values are designed for the client. Database or service credentials are unnecessary in Vercel. Set the Supabase Site URL to the canonical HTTPS app URL once it is available.

## Vercel

1. Import `balexander012/Homemade-by-Bekah` in Vercel. If it does not appear, grant the Vercel GitHub App access to this repository under GitHub **Settings → Applications → Installed GitHub Apps**. Select the Next.js preset and Node.js 22.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to production. Use your staging values for feature-branch previews. Keep `NEXT_PUBLIC_LOCAL_DEMO` unset.
3. Deploy from `main` once the application pull request is merged. On the deployed site, verify authorized sign-in, create a recipe and event, and confirm a second browser sees the records. Check that a nonmember account sees the access screen and that the photo bucket stays private.
4. Follow the [OAuth setup](integration.md) if ChatGPT will use this workspace.

[Vercel’s GitHub deployment guide](https://vercel.com/docs/git/vercel-for-github)

## iPad and iPhone

1. Open the HTTPS app in Safari and sign in.
2. Use Safari’s Share menu and select **Add to Home Screen**. Open the new icon while online before relying on it during a bake.
3. Verify a signed-in bake, disconnect Wi-Fi, finish a step, reload, reconnect, and confirm the step on a second signed-in device. Test an iPhone upload while the iPad has the session open.
4. Timer sound needs an open app and a tap to enable audio. The deadline still runs during a lock or closure. Reopen the app to see the result.

Offline recipes and progress are stored in the browser profile for that signed-in identity. Use a trusted personal device and sign out before handing it off. Photo uploads and recipe revisions require connectivity. Reconnect to synchronize queued planner and session changes.
