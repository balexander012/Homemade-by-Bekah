"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, CalendarDays, Camera, ChefHat, LayoutDashboard, Settings2, ArrowRight, Clock3 } from "lucide-react";
import type { Session as AuthSession, SupabaseClient } from "@supabase/supabase-js";
import { easternDate, isLaunchCheckSession, timerTime, type Entry } from "@/lib/domain";
import { authStorageKey, browserClient, recordsOf } from "@/lib/store";
import { useWorkspace } from "@/lib/use-workspace";
import { PhotoContext, usePhotoStore } from "@/lib/recipe-photos";
import { Brand, Button, Field, message } from "./ui";

import { Recipes, RecipeDetail, RecipeEditor } from "./recipes";
import { Today, Calendar, EventEditor } from "./planner";
import { StartSession } from "./session";
import { BakeLanding, FocusedBakingSession } from "./session-focus";
import { Photos } from "./photos";
import { More, type Theme } from "./more";

const demoEnabled = process.env.NEXT_PUBLIC_LOCAL_DEMO === "1";
const demoWorkspace = "10000000-0000-4000-8000-000000000000";
type WorkspaceChoice = { id: string; name: string };
const nav = [
  { label: "Today", icon: LayoutDashboard }, { label: "Recipes", icon: BookOpen },
  { label: "Bake", icon: ChefHat }, { label: "Calendar", icon: CalendarDays },
  { label: "Photos", icon: Camera },
] as const;
type Tab = typeof nav[number]["label"] | "More" | "Ideas";
type Detail =
  | { screen: "event"; date: string; id?: string; title?: string }
  | { screen: "recipe" | "recipe-form"; id?: string; name?: string }
  | { screen: "start"; date: string; eventId?: string; versionId?: string }
  | { screen: "session"; id: string };

const tabPaths: Record<Tab, string> = {
  Today: "/", Recipes: "/recipes", Bake: "/bake", Calendar: "/planner", Photos: "/photos", More: "/settings", Ideas: "/ideas",
};
function pathFor(tab: Tab, detail?: Detail) {
  if (!detail) return tabPaths[tab];
  const p = new URLSearchParams();
  if (detail.screen === "recipe") return "/recipes/" + encodeURIComponent(detail.id ?? "");
  if (detail.screen === "recipe-form") {
    if (detail.name) p.set("name", detail.name);
    return (detail.id ? "/recipes/" + encodeURIComponent(detail.id) + "/edit" : "/recipes/new") +
      (p.size ? "?" + p : "");
  }
  if (detail.screen === "session") return "/bake/" + encodeURIComponent(detail.id);
  if (detail.screen === "start") {
    p.set("date", detail.date);
    if (detail.eventId) p.set("eventId", detail.eventId);
    if (detail.versionId) p.set("versionId", detail.versionId);
    return "/bake/new?" + p;
  }
  if (detail.screen === "event") {
    p.set("date", detail.date);
    if (detail.id) p.set("id", detail.id);
    if (detail.title) p.set("title", detail.title);
    return "/planner/event?" + p;
  }
  return tabPaths[tab];
}
function locationState(): { tab: Tab; detail?: Detail } {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(window.location.search);
  const sections = pathname.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (pathname === "/recipes/new") return { tab: "Recipes", detail: { screen: "recipe-form", name: params.get("name") ?? undefined } };
  if (sections[0] === "recipes" && sections[1]) return { tab: "Recipes", detail:
    sections[2] === "edit" ? { screen: "recipe-form", id: sections[1] } : { screen: "recipe", id: sections[1] } };
  if (pathname === "/bake/new") return { tab: "Bake", detail: { screen: "start",
    date: params.get("date") ?? easternDate(), eventId: params.get("eventId") ?? undefined, versionId: params.get("versionId") ?? undefined } };
  if (sections[0] === "bake" && sections[1]) return { tab: "Bake", detail: { screen: "session", id: sections[1] } };
  if (pathname === "/planner/event") return { tab: "Calendar", detail: {
    screen: "event", date: params.get("date") ?? easternDate(),
    id: params.get("id") ?? undefined, title: params.get("title") ?? undefined } };
  const current = (Object.keys(tabPaths) as Tab[]).find((tab) => tabPaths[tab] === pathname);
  const legacy = window.location.hash.slice(1).toLowerCase();
  const old = ({ today: "Today", recipes: "Recipes", calendar: "Calendar",
    photos: "Photos", more: "More" } as Record<string, Tab>)[legacy];
  return { tab: old ?? current ?? "Today" };
}


export function BakingApp() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>();
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offlineIdentity, setOfflineIdentity] = useState<string>();
  const [online, setOnline] = useState(true);
  const userId = session?.user.id ?? (!online ? offlineIdentity : undefined);

  useEffect(() => {
    setClient(browserClient());
    setHydrated(true);
    const status = () => {
      setOnline(navigator.onLine);
      try {
        const stored = JSON.parse(localStorage.getItem(authStorageKey) ?? "null");
        setOfflineIdentity(typeof stored?.user?.id === "string" && localStorage.getItem(`bekah-memberships:${stored.user.id}`) ? stored.user.id : undefined);
      } catch { setOfflineIdentity(undefined); }
    };
    status();
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    return () => { window.removeEventListener("online", status); window.removeEventListener("offline", status); };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => { /* The online app can run without a worker. */ });
    }
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event, auth) => {
      if (event === "SIGNED_OUT") {
        setOfflineIdentity(undefined);
        setWorkspaces(undefined);
        setWorkspaceId("");
      }
      setSession(auth);
      setBooting(false);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!client || !userId) return;
    let live = true;
    const key = `bekah-memberships:${userId}`;
    async function membership() {
      try {
        if (!navigator.onLine) {
          const cached = localStorage.getItem(key);
          if (live) setWorkspaces(cached ? JSON.parse(cached) : []);
          return;
        }
        const result = await client!.from("workspaces").select("id,name").order("name");
        if (!live) return;
        if (result.error) throw new Error(result.error.message);
        setWorkspaces(result.data);
        try { localStorage.setItem(key, JSON.stringify(result.data)); } catch { /* Optional local cache. */ }
      } catch (cause) { if (live) { setWorkspaces([]); setError(message(cause)); } }
    }
    void membership();
    window.addEventListener("online", membership);
    return () => { live = false; window.removeEventListener("online", membership); };
  }, [client, userId]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const { error } = await client.auth.signInWithPassword({ email: String(fields.get("email")).trim(), password: String(fields.get("password")) });
      if (error) throw error;
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!client || !userId) return;
    setOfflineIdentity(undefined);
    setWorkspaces(undefined);
    setWorkspaceId("");
    setSession(null);
    try { await client.auth.signOut({ scope: "local" }); }
    finally {
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith(`bekah-v1:${userId}:`) || key === `bekah-memberships:${userId}` || key === authStorageKey || key.startsWith(`${authStorageKey}-`)) {
            localStorage.removeItem(key);
          }
        }
      } catch { setError("Device storage could not be cleared. Close this tab and clear site data on a shared device."); }
    }
  }

  if (hydrated && !client && demoEnabled) return <Workspace client={null} workspace={demoWorkspace} identity="demo" signOut={() => {}} />;
  const selected = workspaces?.find((workspace) => workspace.id === workspaceId) ?? (workspaces?.length === 1 ? workspaces[0] : undefined);
  if (userId && selected && client) return <Workspace key={`${userId}:${selected.id}`} client={client}
    workspace={selected.id} identity={userId} signOut={() => void signOut()} />;
  return <main className="signin"><section className="panel stack">
    <Brand />
    {!hydrated || (client && booting && online) || (userId && !workspaces) ? <p role="status">Opening your kitchen…</p> :
      userId && workspaces?.length ? <><h1>Choose a kitchen</h1>{workspaces.map((workspace) =>
        <Button onClick={() => setWorkspaceId(workspace.id)} key={workspace.id}>{workspace.name}</Button>)}</> :
      userId ? <><h1>Workspace access</h1><p>Your account needs an invitation to this baking workspace.</p><Button onClick={() => void signOut()}>Sign out</Button></> :
      client ? <><h1>Sign in</h1><form onSubmit={login} className="stack">
        <Field label="Email"><input type="email" name="email" required autoComplete="username" /></Field>
        <Field label="Password"><input type="password" name="password" required autoComplete="current-password" /></Field>
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button></form></> :
      <><h1>Kitchen setup</h1><p>Connect the project to Supabase to sign in to your private workspace.</p></>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section></main>;
}

function Workspace({ client, workspace, identity, signOut }: { client: SupabaseClient | null; workspace: string; identity: string; signOut: () => void }) {
  const demo = !client;
  const store = useWorkspace(client, workspace, identity, demo);
  const photoStore = usePhotoStore(client, workspace);
  const [tab, setTab] = useState<Tab>("Today");
  const [detail, setDetail] = useState<Detail>();
  useEffect(() => {
    const sync = () => { const state = locationState(); setTab(state.tab); setDetail(state.detail); };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const [now, setNow] = useState(Date.now);
  const today = easternDate(new Date(now));
  const [day, setDay] = useState(today);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const theme = localStorage.getItem("bekah-theme");
      return theme === "light" || theme === "dark" ? theme : "system";
    } catch { return "system"; }
  });
  const [audioReady, setAudioReady] = useState(false);
  const [alerts, setAlerts] = useState(() => {
    try { return localStorage.getItem("bekah-timer-alerts") === "on" && "Notification" in window && Notification.permission === "granted"; }
    catch { return false; }
  });
  const [alertMessage, setAlertMessage] = useState("");
  const audio = useRef<AudioContext | null>(null);
  const played = useRef(new Set<string>());
  const notified = useRef(new Set<string>());
  const detailId = detail && "id" in detail ? detail.id : undefined;
  const event = detail?.screen === "start" || detail?.screen === "event" ?
    recordsOf(store.records, "event").find((item) => item.id === (detail.screen === "start" ? detail.eventId : detail.id)) : undefined;
  const version = store.library.versions.find((item) => item.id === detailId);
  const allSessions = recordsOf(store.records, "session").filter((item) => !isLaunchCheckSession(item.document.title));
  const sessions = allSessions.filter((item) => !item.document.cleared);
  const active = sessions.find((item) => item.id === detailId);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("bekah-theme", theme); } catch { /* Theme can still change for this session. */ }
  }, [theme]);
  useEffect(() => { window.scrollTo(0, 0); }, [tab, detail]);
  useEffect(() => () => { if (audio.current && audio.current.state !== "closed") void audio.current.close(); }, []);
  const prepareAudio = useCallback(() => {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().then(() => setAudioReady(audio.current?.state === "running")).catch(() => {});
    } catch { setAudioReady(false); }
  }, []);
  useEffect(() => {
    if (!audioReady || audio.current?.state !== "running") return;
    const ctx = audio.current;
    const ready = recordsOf(store.records, "session").filter((item) => item.document.status === "Active")
      .flatMap((item) => item.document.timers)
      .filter((timer) => !timer.cancelled && timer.deadline <= now && !played.current.has(`${timer.id}:${timer.deadline}`));
    if (!ready.length) return;
    for (const timer of ready) played.current.add(`${timer.id}:${timer.deadline}`);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = 660;
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 1);
  }, [audioReady, now, store.records]);

  useEffect(() => {
    if (!alerts || !("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
    const done = recordsOf(store.records, "session").filter((entry) => entry.document.status === "Active")
      .flatMap((entry) => entry.document.timers)
      .filter((timer) => !timer.cancelled && timer.deadline <= now && !notified.current.has(`${timer.id}:${timer.deadline}`));
    for (const timer of done) {
      const tag = `${timer.id}:${timer.deadline}`;
      notified.current.add(tag);
      // Keep labels private on the lock screen. The app shows the matching batch.
      void navigator.serviceWorker.getRegistration().then((worker) =>
        worker?.showNotification("Baking timer ready", { body: "Open Homemade by Bekah to check the bake.", tag, icon: "/icon-192.png" })).catch(() => {});
    }
  }, [alerts, now, store.records]);

  async function toggleAlerts() {
    setAlertMessage("");
    if (alerts) {
      setAlerts(false);
      localStorage.removeItem("bekah-timer-alerts");
      return;
    }
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        setAlertMessage("This browser does not offer timer notifications here. The timer and sound are available in the open app.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setAlertMessage("Timer notification permission was not granted."); return; }
      if (!await navigator.serviceWorker.getRegistration()) { setAlertMessage("Timer notifications need the installable app. Timer sound is available in this tab."); return; }
      setAlerts(true);
      localStorage.setItem("bekah-timer-alerts", "on");
    } catch { setAlertMessage("Could not enable timer notifications on this device."); }
  }

  const navigate = (next: Detail) => {
    const related: Tab = next.screen === "recipe" || next.screen === "recipe-form" ? "Recipes" :
      next.screen === "event" ? "Calendar" : "Bake";
    setTab(related);
    setDetail(next);
    window.history.pushState(null, "", pathFor(related, next));
  };
  const open = (next: Tab) => {
    setTab(next);
    setDetail(undefined);
    if (window.location.pathname !== tabPaths[next] || window.location.search || window.location.hash)
      window.history.pushState(null, "", tabPaths[next]);
  };
  const edit = (date: string, event?: Entry<"event">) => navigate({ screen: "event", date, id: event?.id });
  const resume = (id: string) => navigate({ screen: "session", id });
  const start = (date: string, planned?: Entry<"event">) => {
    const existing = planned && sessions.find((session) => session.document.eventId === planned.id && session.document.date === date);
    if (existing) resume(existing.id);
    else navigate({ screen: "start", date, eventId: planned?.id });
  };

  function render() {
    if (store.loading) return <p role="status">Loading your baking workspace…</p>;
    if (detail?.screen === "recipe-form") return <RecipeEditor key={detail.id ?? detail.name ?? "new"} store={store} version={version} initialName={detail.name}
      complete={(id) => { setTab("Recipes"); navigate({ screen: "recipe", id }); }} cancel={() => { if (version) navigate({ screen: "recipe", id: version.id }); else open("Recipes"); }} />;
    if (detail?.screen === "recipe" && version) return <RecipeDetail key={version.id} store={store} version={version}
      show={(id) => navigate({ screen: "recipe", id })} edit={() => navigate({ screen: "recipe-form", id: version.id })}
      back={() => open("Recipes")} bake={() => navigate({ screen: "start", date: today, versionId: version.id })} />;
    if (detail?.screen === "event") return <EventEditor key={detail.id ?? "new"} day={detail.date} entry={event} initialTitle={detail.title} store={store}
      close={(selectedDay, saved) => { setDay(selectedDay); if (saved) open("Calendar"); else open("Calendar"); }} />;
    if (detail?.screen === "start") return <StartSession date={detail.date} event={event} initialVersion={detail.versionId} store={store} close={() => open("Bake")} started={resume} browse={() => open("Recipes")} />;
    if (detail?.screen === "session" && active) return <FocusedBakingSession key={active.id} entry={active} store={store} now={now} photos={() => open("Photos")} audioReady={audioReady} sound={prepareAudio} exit={() => open("Bake")} />;
    switch (tab) {
      case "Today": return <Today today={today} now={now} store={store} edit={edit} start={start} resume={resume} showCalendar={(date) => { setDay(date); open("Calendar"); }} showPhotos={() => open("Photos")} showRecipes={() => open("Recipes")} />;
      case "Bake": return <BakeLanding sessions={allSessions} now={now} start={() => start(today)} resume={resume} store={store} />;
      case "Calendar": return <Calendar day={day} setDay={setDay} today={today} store={store} edit={edit} start={start} />;
      case "Recipes": return <Recipes store={store} show={(id) => navigate({ screen: "recipe", id })} edit={() => navigate({ screen: "recipe-form" })} ideas={() => open("Ideas")} />;
      case "Photos": return <Photos store={store} client={client} workspace={workspace} />;
      case "Ideas":
      case "More": return <More section={tab === "Ideas" ? "ideas" : "settings"} store={store} client={client} workspace={workspace} theme={theme} setTheme={setTheme} alerts={alerts} alertMessage={alertMessage} toggleAlerts={() => void toggleAlerts()} signOut={signOut} demo={demo}
        createRecipe={(name) => navigate({ screen: "recipe-form", name })}
        schedule={(title, date) => navigate({ screen: "event", title, date: date ?? today })} />;
    }
  }

  const pending = Object.values(store.queue);
  const running = sessions.filter((item) => item.document.status === "Active");
  const nextTimer = running.flatMap((item) => item.document.timers).filter((timer) => !timer.cancelled).sort((a, b) => a.deadline - b.deadline)[0];
  return <PhotoContext.Provider value={photoStore}><div className="shell">
    <a href="#workspace" className="skip">Skip to content</a>
    <aside className="rail">
      <div className="rail-head"><img className="rail-logo" src="/brand/hb-app-icon.svg" alt="" width="48" height="48" />
        <span className="rail-brand"><strong>Homemade by Bekah</strong><small>Kitchen workspace</small></span></div>
      <nav aria-label="Main navigation">
        {nav.map(({ label, icon: Icon }) => <button type="button" key={label} aria-current={tab === label || (label === "Recipes" && tab === "Ideas") ? "page" : undefined} onClick={() => open(label)}>
          <Icon size={21} strokeWidth={1.8} aria-hidden="true" /><span>{label === "Today" ? "Home" : label === "Calendar" ? "Planner" : label}</span>
        </button>)}
      </nav>
      <div className="rail-footer">
        {running.length > 0 && <button type="button" className="rail-running" onClick={() => resume(running[0].id)}>
          <Clock3 size={19} aria-hidden="true" /><span><strong>Resume baking</strong><small>{nextTimer ? timerTime(nextTimer.deadline - now) + " next timer" : running[0].document.title}</small></span><ArrowRight size={16}/></button>}
        <button type="button" className="rail-settings" aria-current={tab === "More" ? "page" : undefined} onClick={() => open("More")}>
          <Settings2 size={21} aria-hidden="true" /><span>Settings</span></button>
      </div>
    </aside>
    <main className="workspace" id="workspace">
      <header className="mobile-topbar"><span>Homemade by Bekah</span><button type="button" aria-label="Settings" onClick={() => open("More")}><Settings2 size={22}/></button></header>
      {running.length > 0 && detail?.screen !== "session" && <button type="button" className="mobile-resume" onClick={() => resume(running[0].id)}>
        <Clock3 size={17} aria-hidden="true" /><strong>Resume baking</strong><span>{nextTimer ? timerTime(nextTimer.deadline - now) : ""}</span><ArrowRight size={17} aria-hidden="true"/></button>}
      <div className="statusbar">
        {demo && <span className="hb-sync hb-sync--pending">Local demo</span>}
        {!store.online && <span role="status" className="hb-sync hb-sync--offline">Offline</span>}
        {pending.length > 0 && <span role="status" className="hb-sync hb-sync--pending">{pending.length} unsynced</span>}
      </div>
      <div className="stack">
        {store.error && <div className="notice error stack" role="alert"><p>{store.error}</p><Button tone="secondary" onClick={() => void store.sync()}>Retry sync</Button></div>}
        {pending.filter((item) => item.conflict).map((item) => <section className="notice warning stack" key={item.entry.id}>
          <p>A {item.entry.kind} changed on another device. Choose which copy to keep.</p>
          <div className="actions"><Button tone="secondary" onClick={() => void store.resolve(item.entry.id, true)}>Keep this device’s copy</Button>
            <Button tone="secondary" onClick={() => void store.resolve(item.entry.id, false)}>Use synced copy</Button></div>
        </section>)}
      </div>
      {render()}
    </main>
  </div></PhotoContext.Provider>;
}
