import { analyzeLesson, refineProfile } from "@/lib/ai";
import { addLesson, clampText, getCopywriter, saveProfile } from "@/lib/db";
import { AppError, fail, jsonBody, ok } from "@/lib/http";

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
    const aiText = clampText(body.aiText, 18000);
    const idealText = clampText(body.idealText, 18000);
    if (!aiText || !idealText) {
      throw new AppError("Добавьте работу ИИ и идеальный текст человека.");
    }

    let copywriter = await getCopywriter(id);
    if (!copywriter.has_profile) {
      throw new AppError("Сначала обучите базовый профиль на примерах автора.");
    }

    const analysis = await analyzeLesson({ copywriter, aiText, idealText });
    const profile = await refineProfile(copywriter.profile, analysis);
    await saveProfile(id, profile);
    const lesson = await addLesson(id, aiText, idealText, analysis);
    copywriter = await getCopywriter(id);

    return ok({ lesson, copywriter });
  } catch (error) {
    return fail(error);
  }
}
