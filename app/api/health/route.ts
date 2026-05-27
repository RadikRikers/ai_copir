import { ok } from "@/lib/http";
import { aiRuntimeConfig } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ai = aiRuntimeConfig();
  return ok({
    provider: ai.provider,
    model: ai.model,
    llm_configured: ai.configured,
    missing_llm_env: ai.missingEnv || null,
    database_configured: Boolean(process.env.DATABASE_URL),
  });
}
