import { generateCopy, trainingStatus } from "@/lib/ai";
import { AppError, fail, jsonBody, ok } from "@/lib/http";
import { getCopywriter } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await jsonBody(request);
    const copywriter = await getCopywriter(id);
    const status = trainingStatus(copywriter.examples || []);
    if (!status.ready) {
      throw new AppError(`Агент ещё не готов к полноценной работе. ${status.guidance.join(" ")}`, 409);
    }
    if (!copywriter.has_profile) {
      throw new AppError("Минимум материалов набран. Нажмите «Обучить», дождитесь завершения и после этого запускайте генерацию.", 409);
    }
    const result = await generateCopy({ copywriter, body });
    return ok({ result });
  } catch (error) {
    return fail(error);
  }
}
