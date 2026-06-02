import { addRecommendations, getCopywriter } from "@/lib/db";
import { fail, jsonBody, ok, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    requireAccess(request);
    const { id } = await context.params;
    const body = await jsonBody(request);
    const saved = await addRecommendations(id, body);
    return ok({ saved, copywriter: await getCopywriter(id) }, 201);
  } catch (error) {
    return fail(error);
  }
}
