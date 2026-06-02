import { deleteRecommendation } from "@/lib/db";
import { fail, ok, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    requireAccess(_request);
    const { id } = await context.params;
    await deleteRecommendation(id);
    return ok({});
  } catch (error) {
    return fail(error);
  }
}
