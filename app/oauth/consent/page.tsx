import { mcpConfig } from "@/lib/integration";
import { Consent } from "./consent";
import { Brand } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const config = mcpConfig();
  const { authorization_id: id } = await searchParams;
  return <main className="signin"><section className="panel stack"><Brand />
    <h1>Connect ChatGPT</h1>
    {config && typeof id === "string" && id.length <= 200 ? <Consent id={id} clientId={config.clientId} /> :
      <p>This authorization link is unavailable. Start the connection from ChatGPT.</p>}
  </section></main>;
}
