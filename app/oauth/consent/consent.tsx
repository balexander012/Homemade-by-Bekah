"use client";

import { useEffect, useState } from "react";
import { Button, Field, message } from "@/components/ui";
import { browserClient } from "@/lib/store";

export function Consent({ id, clientId }: { id: string; clientId: string }) {
  const [client] = useState(() => typeof window === "undefined" ? null : browserClient());
  const [signedIn, setSignedIn] = useState(false);
  const [redirect, setRedirect] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorText, setError] = useState("");
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    if (!signedIn || !client) return;
    let live = true;
    void client.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) { setError(error?.message ?? "Authorization unavailable."); return; }
      if ("client" in data) {
        if (data.client.id !== clientId) { setError("This client is unavailable for the baking workspace."); return; }
        setAllowed(true);
      } else if ("redirect_url" in data) setRedirect(data.redirect_url);
    }).catch((cause) => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [client, clientId, id, signedIn]);
  async function finish(approve: boolean) {
    if (!client || !allowed || busy) return;
    setBusy(true);
    setError("");
    try {
      const outcome = approve ? await client.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true }) :
        await client.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
      if (outcome.error) throw outcome.error;
      const target = new URL(outcome.data.redirect_url);
      if (target.origin !== "https://chatgpt.com") throw new Error("Unexpected ChatGPT callback.");
      window.location.assign(target.href);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <>
    {!signedIn && <form className="stack" onSubmit={async (event) => {
      event.preventDefault();
      if (!client) return;
      setBusy(true); setError("");
      try {
        const form = new FormData(event.currentTarget);
        const result = await client.auth.signInWithPassword({ email: String(form.get("email")), password: String(form.get("password")) });
        if (result.error) throw result.error;
      } catch (cause) { setError(message(cause)); }
      finally { setBusy(false); }
    }}><Field label="Email"><input type="email" name="email" autoComplete="username" required /></Field>
      <Field label="Password"><input type="password" name="password" autoComplete="current-password" required /></Field>
      <Button type="submit" disabled={busy}>Sign in</Button></form>}
    {allowed && <><p>Allow ChatGPT to access the recipes, plans and sessions your workspace administrator has authorized. A write-enabled connection can save changes you request.</p>
      <div className="actions"><Button disabled={busy} onClick={() => void finish(true)}>Allow access</Button><Button tone="secondary" disabled={busy} onClick={() => void finish(false)}>Deny</Button></div></>}
    {redirect.startsWith("https://chatgpt.com/") && <a href={redirect}>Return to ChatGPT</a>}
    {errorText && <p className="notice error" role="alert">{errorText}</p>}
  </>;
}
