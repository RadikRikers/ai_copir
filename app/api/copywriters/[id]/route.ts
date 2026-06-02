import { deleteCopywriter, getCopywriter, updateCopywriter } from "@/lib/db";
import { fail, jsonBody, ok, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    requireAccess(_request);
    const { id } = await context.params;
    return ok({ copywriter: await getCopywriter(id) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    requireAccess(_request);
    const { id } = await context.params;
    await deleteCopywriter(id);
    return ok({});
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireAccess(request);
    const { id } = await context.params;
    const body = await jsonBody(request);
    return ok({ copywriter: await updateCopywriter(id, body) });
  } catch (error) {
    return fail(error);
  }
}
