import { latestSyncVersion } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok({ version: await latestSyncVersion() });
  } catch (error) {
    return fail(error);
  }
}
