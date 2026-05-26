import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    model: process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini",
    llm_configured: Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL),
    database_configured: Boolean(process.env.DATABASE_URL),
  });
}
