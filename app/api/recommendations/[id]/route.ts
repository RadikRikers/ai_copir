import { deleteRecommendation } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteRecommendation(id);
    return ok({});
  } catch (error) {
    return fail(error);
  }
}
