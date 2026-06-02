import { analyzeStyle } from "@/lib/ai";
import { getCopywriter, saveProfile } from "@/lib/db";
import { fail, ok, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    requireAccess(request);
    const { id } = await context.params;
    const copywriter = await getCopywriter(id);
    const profile = await analyzeStyle(copywriter.examples || []);
    await saveProfile(id, profile);
    return ok({ copywriter: await getCopywriter(id) });
  } catch (error) {
    return fail(error);
  }
}
