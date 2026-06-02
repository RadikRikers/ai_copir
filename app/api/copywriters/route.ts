import { createCopywriter, listCopywriters } from "@/lib/db";
import { fail, jsonBody, ok, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return ok({ copywriters: await listCopywriters() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    requireAccess(request);
    const body = await jsonBody(request);
    return ok({ copywriter: await createCopywriter(body) }, 201);
  } catch (error) {
    return fail(error);
  }
}
