# ChatGPT integration

The app exposes a stateless Streamable HTTP MCP server at `/api/mcp`. Its tools read and update records in the same Supabase workspace used by the iPad. Recipe writes create drafts or immutable draft revisions. Cancellation, recipe approval and photo access stay in the app. The integration supports explicit actions requested by the baker. Availability within the existing Bekah Baking Project depends on the ChatGPT account and workspace settings.

## Connect a staging workspace

1. Finish the [deployment setup](deployment.md). Use the canonical Vercel HTTPS URL and a test workspace first.
2. In Supabase Authentication, enable its OAuth 2.1 server, configure the authorization path as `/oauth/consent`, and leave dynamic registration disabled. Register a static OAuth client using the exact callback URI displayed by ChatGPT’s custom MCP setup. Use PKCE and the client authentication method supported by both services.
3. In Vercel set `MCP_RESOURCE_URL` to `https://YOUR-APP-HOST/api/mcp` and `MCP_OAUTH_CLIENT_ID` to the client UUID. Place an OAuth client secret, if issued, in ChatGPT’s credential form.
4. In the Supabase SQL editor register a grant per allowed user. Replace the placeholders. Use `false` for read-only access.

```sql
insert into public.baking_oauth_grants (client_id, workspace_id, user_id, resource, can_write)
values ('CLIENT_UUID', 'WORKSPACE_UUID', 'USER_UUID', 'https://YOUR-APP-HOST/api/mcp', true);
```

5. Under Supabase Auth Hooks, enable the Custom Access Token hook and select the migration’s `public.baking_oauth_token_hook` function. This binds OAuth tokens to the MCP resource. Standard `openid` is used during consent. Workspace and write permissions are controlled by the explicit grant and enforced by RLS.
6. Redeploy after changing Vercel variables. Verify protected-resource discovery at `/.well-known/oauth-protected-resource/api/mcp` and a `401` OAuth challenge from an anonymous POST to `/api/mcp`. Configure the custom MCP plugin with OAuth in ChatGPT, then sign in and consent as an invited user.
7. Confirm listing recipes, creating a draft baking event, reading it from the iPad, retrying with the same request UUID, rejecting an uninvited user, and rejecting writes with a read-only grant. Confirm the OAuth token can read only the authorized workspace and cannot download photos. Remove the grant row to revoke access.

For current setup screens, consult [OpenAI’s custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server), [OpenAI’s OAuth guide](https://developers.openai.com/plugins/build/auth), and [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication). The Supabase OAuth server is a beta feature. Keep the staging OAuth check as a release requirement.

## Authenticated fallback

A trusted client can POST JSON to `/api/integration` with `Authorization: Bearer <user-access-token>`. Obtain the access token through normal Supabase sign-in. Keep it in memory and out of transcripts and shell history.

```json
{
  "tool": "get_todays_plan",
  "input": { "from": "2026-11-22" }
}
```

The request uses the user’s current workspace membership. Supply a workspace UUID when the user has more than one workspace. Create operations take a caller-generated UUID. Reuse it for retries. Updates take the last observed revision and return a conflict on competing changes. Use exact Eastern dates, omit unknown times, and save plans with unresolved information as drafts. In the app, pasted conversation text can also be retained in a draft for manual review.
