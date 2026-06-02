import { latestSyncVersion } from "@/lib/db";
import { fail, ok, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return ok({ version: await latestSyncVersion() });
  } catch (error) {
    return fail(error);
  }
}
