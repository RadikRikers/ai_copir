import { ok } from "@/lib/http";
import { aiRuntimeConfig } from "@/lib/ai";
import { latestSyncVersion } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ai = aiRuntimeConfig();
  let databaseOk = false;
  let databaseError = "";

  if (process.env.DATABASE_URL) {
    try {
      await latestSyncVersion();
      databaseOk = true;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : "БД не ответила";
    }
  }

  return ok({
    provider: ai.provider,
    model: ai.model,
    llm_configured: ai.configured,
    missing_llm_env: ai.missingEnv || null,
    database_configured: Boolean(process.env.DATABASE_URL),
    database_ok: databaseOk,
    database_error: databaseError,
    access_required: Boolean(process.env.APP_ACCESS_CODE?.trim()),
  });
}
