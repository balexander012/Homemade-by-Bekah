import { authenticate, integrationFailure } from "@/lib/integration";
import { fetchRecipeSource } from "@/lib/public-recipe-source";
import { parseRecipeImport } from "@/lib/recipe-import";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try { await authenticate(request, false); }
  catch (cause) {
    const { status, error } = integrationFailure(cause);
    return Response.json({ error }, { status, headers });
  }
  try {
    const text = await request.text();
    if (text.length > 4096) return Response.json({ error: "Enter a shorter recipe link." }, { status: 422, headers });
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string") throw new Error();
    const { html, source } = await fetchRecipeSource(body.url.trim());
    const recipe = parseRecipeImport(html, source);
    if (recipe) return Response.json({ recipe }, { headers });
    return Response.json({ error: "No structured recipe was found. Paste the recipe text for manual review." }, { status: 422, headers });
  } catch {
    return Response.json({ error: "The recipe link could not be imported. Check the link or paste the recipe text." }, { status: 422, headers });
  }
}
