import { analyzeStyle } from "@/lib/ai";
import { getCopywriter, saveProfile } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const copywriter = await getCopywriter(id);
    const profile = await analyzeStyle(copywriter.examples || []);
    await saveProfile(id, profile);
    return ok({ copywriter: await getCopywriter(id) });
  } catch (error) {
    return fail(error);
  }
}
