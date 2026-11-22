import { authenticate, integrationFailure, invoke, isOperation, IntegrationError } from "@/lib/integration";

const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  try {
    const context = await authenticate(request, false);
    const content = await request.text();
    if (content.length > 200000) throw new IntegrationError("The request is too large.", 413);
    const body: unknown = JSON.parse(content);
    if (!body || typeof body !== "object" || !("tool" in body) || typeof body.tool !== "string" || !isOperation(body.tool)) {
      throw new IntegrationError("Choose a supported tool.", 400);
    }
    const result = await invoke(context, body.tool, "input" in body ? body.input : {});
    return Response.json({ result }, { headers });
  } catch (cause) {
    const { status, error } = integrationFailure(cause);
    return Response.json({ error }, { status, headers });
  }
}
