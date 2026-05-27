import OpenAI from "openai";
import { AppError } from "./http";
import { clampText } from "./db";
import type {
  Copywriter,
  IncomingFile,
  LessonAnalysis,
  StoredExample,
  StoredLesson,
  StoredRecommendation,
  StyleProfile,
} from "./types";

let aiClient: OpenAI | null = null;
let aiClientCacheKey = "";

const MAX_TEXT_CHARS = 18000;
const MAX_EXAMPLE_CHARS = 6000;
const MAX_IMAGE_COUNT = 10;
const MIN_READY_EXAMPLES = 6;
const MIN_READY_TEXT_CHARS = 2500;
const RECOMMENDED_SHORT_POSTS = 10;
const MAX_TRAINING_EXAMPLES = 24;
const MAX_GENERATION_EXAMPLES = 6;
const MAX_LESSONS_IN_PROMPT = 8;
const MAX_LEARNED_CORRECTIONS = 14;

type AiProvider = "openrouter" | "gemini" | "openai" | "custom";

type AiRuntimeConfig = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
  configured: boolean;
  missingEnv?: string;
  defaultHeaders?: Record<string, string>;
};

function cleanEnv(value: string | undefined) {
  const text = value?.trim() || "";
  if (!text || text.includes("твой_") || text.includes("строка_подключения")) return "";
  return text;
}

function publicAppUrl() {
  const value = cleanEnv(process.env.APP_URL) || cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!value) return "https://vercel.app";
  return value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
}

function resolveProvider(): AiProvider {
  const explicit = cleanEnv(process.env.AI_PROVIDER || process.env.LLM_PROVIDER).toLowerCase();
  if (["openrouter", "gemini", "openai", "custom"].includes(explicit)) return explicit as AiProvider;
  if (cleanEnv(process.env.OPENROUTER_API_KEY)) return "openrouter";
  if (cleanEnv(process.env.GEMINI_API_KEY)) return "gemini";
  if (cleanEnv(process.env.OPENAI_API_KEY)) return "openai";
  return "openrouter";
}

export function aiRuntimeConfig(): AiRuntimeConfig {
  const provider = resolveProvider();

  if (provider === "openrouter") {
    const apiKey = cleanEnv(process.env.OPENROUTER_API_KEY);
    return {
      provider,
      apiKey,
      model: cleanEnv(process.env.OPENROUTER_MODEL) || cleanEnv(process.env.LLM_MODEL) || "openrouter/free",
      baseURL: cleanEnv(process.env.OPENROUTER_BASE_URL) || "https://openrouter.ai/api/v1",
      configured: Boolean(apiKey),
      missingEnv: apiKey ? undefined : "OPENROUTER_API_KEY",
      defaultHeaders: {
        "HTTP-Referer": publicAppUrl(),
        "X-OpenRouter-Title": "AI Copywriter Agent",
      },
    };
  }

  if (provider === "gemini") {
    const apiKey = cleanEnv(process.env.GEMINI_API_KEY);
    return {
      provider,
      apiKey,
      model: cleanEnv(process.env.GEMINI_MODEL) || cleanEnv(process.env.LLM_MODEL) || "gemini-2.5-flash",
      baseURL: cleanEnv(process.env.GEMINI_BASE_URL) || "https://generativelanguage.googleapis.com/v1beta/openai/",
      configured: Boolean(apiKey),
      missingEnv: apiKey ? undefined : "GEMINI_API_KEY",
    };
  }

  if (provider === "custom") {
    const apiKey = cleanEnv(process.env.LLM_API_KEY) || cleanEnv(process.env.OPENAI_API_KEY) || "local-llm";
    const baseURL = cleanEnv(process.env.LLM_BASE_URL) || cleanEnv(process.env.OPENAI_BASE_URL);
    return {
      provider,
      apiKey,
      model: cleanEnv(process.env.LLM_MODEL) || cleanEnv(process.env.OPENAI_MODEL) || "local-model",
      baseURL,
      configured: Boolean(baseURL),
      missingEnv: baseURL ? undefined : "LLM_BASE_URL",
    };
  }

  const apiKey = cleanEnv(process.env.OPENAI_API_KEY);
  const baseURL = cleanEnv(process.env.OPENAI_BASE_URL) || cleanEnv(process.env.LLM_BASE_URL);
  return {
    provider: "openai",
    apiKey,
    model: cleanEnv(process.env.OPENAI_MODEL) || cleanEnv(process.env.LLM_MODEL) || "gpt-4o-mini",
    baseURL: baseURL || undefined,
    configured: Boolean(apiKey || baseURL),
    missingEnv: apiKey || baseURL ? undefined : "OPENAI_API_KEY",
  };
}

function getOpenAI() {
  const config = aiRuntimeConfig();
  if (!config.configured) {
    throw new AppError(`Не настроена нейронка. Добавьте ${config.missingEnv} в переменные Vercel.`, 500);
  }

  const cacheKey = `${config.provider}:${config.baseURL || "default"}:${config.apiKey.slice(0, 10)}`;
  if (!aiClient || aiClientCacheKey !== cacheKey) {
    aiClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      defaultHeaders: config.defaultHeaders,
    });
    aiClientCacheKey = cacheKey;
  }
  return { client: aiClient, config };
}

function toAiError(error: unknown, config: AiRuntimeConfig) {
  const details = error as { status?: number; code?: string; message?: string; error?: { message?: string } };
  const status = details?.status;
  const message = details?.error?.message || details?.message || "";

  if (status === 429 || details?.code === "rate_limit_exceeded" || message.includes("429")) {
    if (config.provider === "openrouter") {
      return new AppError("Бесплатный лимит OpenRouter временно исчерпан. Подождите немного и повторите запрос.", 429);
    }
    if (config.provider === "gemini") {
      return new AppError("Бесплатный лимит Gemini временно исчерпан. Подождите немного и повторите запрос.", 429);
    }
    return new AppError("У OpenAI закончилась квота. Переключите сайт на OpenRouter Free или Gemini в переменных Vercel.", 429);
  }

  if (status === 401 || status === 403) {
    return new AppError(`Ключ для провайдера ${config.provider} не принят. Проверьте переменные окружения.`, status);
  }

  return error;
}

function parseJsonObject(raw: string) {
  const text = raw.trim();
  if (!text) throw new AppError("Модель вернула пустой ответ.", 502);
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
  }
  throw new AppError("Модель вернула не JSON. Повторите запрос.", 502);
}

async function callJson({
  messages,
  temperature,
  maxTokens,
}: {
  messages: Array<Record<string, unknown>>;
  temperature: number;
  maxTokens: number;
}) {
  const { client, config } = getOpenAI();
  const request = {
    model: config.model,
    messages: messages as never,
    temperature,
    max_tokens: maxTokens,
  } as any;

  try {
    const response = await client.chat.completions.create({
      ...request,
      response_format: { type: "json_object" },
    });
    return parseJsonObject(response.choices[0]?.message?.content || "");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.toLowerCase().includes("response_format") && !message.toLowerCase().includes("json")) {
      throw toAiError(error, config);
    }
    try {
      const response = await client.chat.completions.create(request);
      return parseJsonObject(response.choices[0]?.message?.content || "");
    } catch (fallbackError) {
      throw toAiError(fallbackError, config);
    }
  }
}

function normaliseDataUrl(value: unknown) {
  const dataUrl = String(value ?? "").trim();
  if (!dataUrl.startsWith("data:image/") || !dataUrl.includes(";base64,")) return "";
  return dataUrl;
}

function collectEntries(entries: Array<StoredExample | StoredRecommendation | IncomingFile>, textLimit = MAX_EXAMPLE_CHARS) {
  const texts: string[] = [];
  const images: Array<{ name: string; dataUrl: string }> = [];

  entries.forEach((entry, index) => {
    const name = clampText(entry.name || `Файл ${index + 1}`, 160);
    const text = clampText("text" in entry ? entry.text : "", textLimit);
    const dataUrl = normaliseDataUrl("dataUrl" in entry ? entry.dataUrl : "");
    if (text) texts.push(`### ${name}\n${text}`);
    if (dataUrl && images.length < MAX_IMAGE_COUNT) {
      images.push({ name, dataUrl });
    }
  });

  return { texts, images };
}

function textChars(examples: StoredExample[]) {
  return examples.reduce((sum, example) => {
    if (example.text?.trim()) return sum + example.text.trim().length;
    if (example.kind === "image" && example.dataUrl) return sum + 450;
    return sum;
  }, 0);
}

export function trainingStatus(examples: StoredExample[]) {
  const exampleCount = examples.length;
  const chars = textChars(examples);
  const ready = exampleCount >= MIN_READY_EXAMPLES && chars >= MIN_READY_TEXT_CHARS;
  const exampleScore = Math.min(50, Math.round((exampleCount / MIN_READY_EXAMPLES) * 50));
  const charScore = Math.min(50, Math.round((chars / MIN_READY_TEXT_CHARS) * 50));
  const guidance: string[] = [];

  if (exampleCount < MIN_READY_EXAMPLES) {
    guidance.push(`Добавьте ещё ${MIN_READY_EXAMPLES - exampleCount} материал(а) автора.`);
  }
  if (chars < MIN_READY_TEXT_CHARS) {
    guidance.push(`Нужно ещё примерно ${MIN_READY_TEXT_CHARS - chars} знаков текста или несколько скриншотов с текстом.`);
  }
  if (exampleCount >= MIN_READY_EXAMPLES && exampleCount < RECOMMENDED_SHORT_POSTS) {
    guidance.push("Если это в основном короткие посты, лучше добрать до 10-12 штук.");
  }
  if (!guidance.length) {
    guidance.push("Минимум набран. Можно использовать агента в работе и улучшать его правками.");
  }

  return {
    ready,
    score: Math.min(100, exampleScore + charScore),
    example_count: exampleCount,
    text_chars: chars,
    required_examples: MIN_READY_EXAMPLES,
    required_text_chars: MIN_READY_TEXT_CHARS,
    recommended_short_posts: RECOMMENDED_SHORT_POSTS,
    used_examples: Math.min(exampleCount, MAX_TRAINING_EXAMPLES),
    capped: exampleCount > MAX_TRAINING_EXAMPLES,
    guidance,
  };
}

export function assertTrainingReady(copywriter: Copywriter) {
  const status = trainingStatus(copywriter.examples || []);
  if (!copywriter.has_profile || !status.ready) {
    const message = status.guidance?.join(" ") || "Сначала завершите обучение агента.";
    throw new AppError(`Агент ещё не готов к полноценной работе. ${message}`, 409);
  }
}

function toStringArray(value: unknown, limit = MAX_LEARNED_CORRECTIONS) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normaliseProfile(profile: StyleProfile, status: ReturnType<typeof trainingStatus>) {
  const next: StyleProfile = {
    ...profile,
    voice: toStringArray(profile.voice, 10),
    structure: toStringArray(profile.structure, 10),
    rhythm: toStringArray(profile.rhythm, 10),
    hooks: toStringArray(profile.hooks, 10),
    vocabulary: toStringArray(profile.vocabulary, 14),
    punctuation: toStringArray(profile.punctuation, 8),
    do: toStringArray(profile.do, 12),
    avoid: toStringArray(profile.avoid, 12),
    learned_corrections: toStringArray(profile.learned_corrections, MAX_LEARNED_CORRECTIONS),
    prompt_addon: clampText(profile.prompt_addon, 1800),
    summary: clampText(profile.summary, 900),
    audience: clampText(profile.audience, 500),
    training_status: status,
  };
  return next;
}

function imageParts(images: Array<{ name: string; dataUrl: string }>, title: string) {
  return images.flatMap((image) => [
    { type: "text", text: `${title}: ${image.name}` },
    { type: "image_url", image_url: { url: image.dataUrl } },
  ]);
}

function htmlToText(rawHtml: string) {
  return rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchArticle(url: string) {
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("Ссылка на источник должна быть корректным URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError("Ссылка на источник должна начинаться с http:// или https://.");
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "AI Copywriter Agent/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (contentType.includes("text/html")) return clampText(htmlToText(text), MAX_TEXT_CHARS);
    if (contentType.includes("text/") || contentType.includes("json")) return clampText(text, MAX_TEXT_CHARS);
  } catch {
    return "";
  }
  return "";
}

const STYLE_SYSTEM = `Ты редактор-аналитик и наставник копирайтеров.
Тебе дают тексты и/или изображения с текстами реального автора. Изучи подачу, но не копируй дословные уникальные фразы.
Собери переносимый профиль стиля: голос, ритм, композиция, лексика, вводки, переходы, финалы, отношение к читателю.
Важно: не переобучайся на одном случайном тексте. Выделяй только устойчивые повторяющиеся признаки, а разовые темы, факты и случайные обороты заноси в avoid.
Ответь строго JSON-объектом:
{
  "summary": "короткое описание стиля",
  "voice": ["..."],
  "structure": ["..."],
  "rhythm": ["..."],
  "hooks": ["..."],
  "vocabulary": ["..."],
  "punctuation": ["..."],
  "audience": "...",
  "do": ["..."],
  "avoid": ["..."],
  "learned_corrections": ["..."],
  "prompt_addon": "инструкция для будущей генерации в этом стиле"
}
Пиши по-русски. Если текст на изображении плохо читается, честно отметь это.`;

const PROFESSIONAL_STANDARD = `Профессиональный стандарт агента:
- Работай на уровне специалиста с образованием не ниже бакалавриата журналистики.
- Держи планку человека с опытом не менее 5 лет в журналистике и копирайтинге.
- Проверяй логику, фактологичность, структуру, ясность и редакторскую этику.
- Методические материалы являются школой качества, но не заменяют стиль выбранного автора.`;

const GENERATE_SYSTEM = `Ты ИИ-агент-копирайтер.
Пиши новый материал по тезисам и источникам, адаптируя его под профиль выбранного копирайтера и накопленные уроки правок.
${PROFESSIONAL_STANDARD}
Правила:
- Не копируй дословно примеры автора и не вставляй их фирменные фразы как цитаты.
- Не выдумывай факты, цифры, имена, даты, адреса и локальные подробности.
- Если источника не хватает, сделай аккуратный текст из доступных тезисов и добавь предупреждение в JSON.
- Если включено региональное приземление, связывай тему с указанным регионом только общими безопасными формулировками или фактами из вводных.
- Если пользователь выбрал "без приземления", не добавляй региональные привязки.
- Итоговый текст должен звучать как живой авторский материал, а не как пересказ технического задания.
Ответь строго JSON-объектом:
{
  "text": "готовый текст",
  "style_fit": "как применен стиль",
  "facts_used": ["ключевые факты из источника"],
  "region_note": "как учтен регион или почему не учтен",
  "warnings": ["что стоит проверить"]
}`;

const LESSON_SYSTEM = `Ты редактор-наставник для ИИ-копирайтера.
Тебе дают два текста: работу ИИ и идеальную версию реального человека. Найди, где ИИ промахнулся по стилю, структуре, тону, детализации, ритму и подаче.
${PROFESSIONAL_STANDARD}
Ответь строго JSON-объектом:
{
  "summary": "главный вывод",
  "mistakes": ["ошибка ИИ"],
  "missing_style_moves": ["что сделал человек, но не сделал ИИ"],
  "overused_patterns": ["что в ИИ-тексте выглядит шаблонно"],
  "rules_to_add": ["новое правило для будущих текстов"],
  "prompt_patch": "короткая инструкция, которую нужно добавить в профиль стиля"
}
Не переписывай текст заново, а именно извлеки урок для будущих генераций.`;

const REFINE_SYSTEM = `Ты поддерживаешь профиль стиля копирайтера.
Обнови существующий JSON-профиль по новому уроку правок. Не удаляй полезные старые правила.
Не переобучай профиль на одной правке: добавляй только переносимые правила, которые помогут будущим текстам. Не запоминай тему, факты и частные формулировки конкретного материала.
Добавь конкретные выводы в learned_corrections и усили prompt_addon, но оставь профиль компактным.
Верни строго JSON-объект профиля с теми же основными полями.`;

export async function analyzeStyle(examples: StoredExample[]) {
  const status = trainingStatus(examples);
  const trainingExamples = examples.slice(0, MAX_TRAINING_EXAMPLES);
  const { texts, images } = collectEntries(trainingExamples);
  if (!texts.length && !images.length) {
    throw new AppError("У копирайтера пока нет примеров для обучения.");
  }

  let prompt =
    "Примеры автора ниже. Составь профиль так, чтобы по нему можно было писать новые материалы в похожей подаче без плагиата.\n\n";
  prompt += texts.length ? texts.join("\n\n") : "Текстовые примеры не приложены.";
  prompt += `\n\nСтатус базы: ${status.example_count} материалов, ${status.text_chars} знаков. Минимум для готовности: ${status.required_examples} материалов и ${status.required_text_chars} знаков.`;
  if (status.capped) {
    prompt += `\nИспользуй только приложенную выборку из ${status.used_examples} материалов как компактное представление стиля.`;
  }
  if (images.length) {
    prompt += "\n\nК запросу приложены изображения с текстами автора. Извлеки текст и учитывай стиль.";
  }

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
    ...imageParts(images, "Изображение с примером"),
  ];
  const profile = (await callJson({
    messages: [
      { role: "system", content: STYLE_SYSTEM },
      { role: "user", content },
    ],
    temperature: 0.25,
    maxTokens: 1500,
  })) as StyleProfile;

  const normalised = normaliseProfile(profile, status);
  normalised.trained_at = new Date().toISOString();
  normalised.source_count = examples.length;
  return normalised;
}

export async function generateCopy({
  copywriter,
  body,
}: {
  copywriter: Copywriter;
  body: Record<string, unknown>;
}) {
  const sourceFiles = Array.isArray(body.sourceFiles) ? (body.sourceFiles as IncomingFile[]) : [];
  const { texts: sourceFileTexts, images: sourceImages } = collectEntries(sourceFiles, MAX_TEXT_CHARS);
  const theses = clampText(body.theses, MAX_TEXT_CHARS);
  const sourceText = clampText(body.sourceText, MAX_TEXT_CHARS);
  const sourceUrl = clampText(body.sourceUrl, 600);
  const fetched = await fetchArticle(sourceUrl);
  const region = clampText(body.region, 200);
  const skipRegion = Boolean(body.skipRegion);
  const outputFormat = clampText(body.format || "Пост для соцсетей", 120);
  const platform = clampText(body.platform || "Универсально", 120);
  const length = clampText(body.length || "средний", 120);

  if (!theses && !sourceText && !sourceUrl && !sourceFileTexts.length && !sourceImages.length) {
    throw new AppError("Добавьте тезисы или источник для нового текста.");
  }

  assertTrainingReady(copywriter);

  const examples = collectEntries((copywriter.examples || []).slice(0, MAX_GENERATION_EXAMPLES));
  const recentLessons = (copywriter.lessons || []).slice(0, MAX_LESSONS_IN_PROMPT).map((lesson) => lesson.analysis);
  const recommendations = collectEntries((copywriter.recommendations || []).slice(0, 8), MAX_TEXT_CHARS);
  const regionRule = skipRegion
    ? "Без регионального приземления: не добавляй город, область и локальные привязки."
    : region
      ? `Региональное приземление включено. Регион: ${region}. Добавь локальный угол без выдуманных фактов.`
      : "Региональное приземление включено, но регион не указан. Не выдумывай регион.";

  const sourceBlocks = [
    sourceUrl ? `Ссылка на источник: ${sourceUrl}` : "",
    fetched ? `Текст, извлеченный по ссылке:\n${fetched}` : "",
    sourceText ? `Вставленный источник:\n${sourceText}` : "",
    sourceFileTexts.length ? `Текстовые файлы источника:\n${sourceFileTexts.join("\n\n")}` : "",
  ].filter(Boolean);

  const prompt = `Копирайтер: ${copywriter.name}

Профиль стиля:
${JSON.stringify(copywriter.profile, null, 2)}

Накопленные уроки правок:
${recentLessons.length ? JSON.stringify(recentLessons, null, 2) : "[пока нет]"}

Методические рекомендации и книги:
${recommendations.texts.length ? recommendations.texts.join("\n\n") : "[не загружены]"}

Контрольные примеры автора:
${examples.texts.length ? examples.texts.join("\n\n") : "[текстовых примеров нет]"}

Задача:
- Формат: ${outputFormat}
- Площадка: ${platform}
- Длина: ${length}
- Региональная настройка: ${regionRule}

Тезисы:
${theses || "[не указаны]"}

Источники:
${sourceBlocks.length ? sourceBlocks.join("\n\n") : "[текстовых источников нет]"}

Напиши готовый материал. Держи стиль автора, учитывай уроки правок, но не повторяй старые формулировки.`;

  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  if (sourceImages.length) {
    content.push({
      type: "text",
      text: "К запросу приложены изображения источника. Извлеки из них факты и используй только то, что читается уверенно.",
    });
    content.push(...imageParts(sourceImages, "Изображение источника"));
  }
  if (recommendations.images.length) {
    content.push({
      type: "text",
      text: "К запросу приложены изображения с методическими рекомендациями. Учитывай их как редакторские принципы, а не как стиль автора.",
    });
    content.push(...imageParts(recommendations.images, "Изображение рекомендации"));
  }

  return callJson({
    messages: [
      { role: "system", content: GENERATE_SYSTEM },
      { role: "user", content },
    ],
    temperature: 0.55,
    maxTokens: 1900,
  });
}

export async function analyzeLesson({
  copywriter,
  aiText,
  idealText,
}: {
  copywriter: Copywriter;
  aiText: string;
  idealText: string;
}) {
  const recommendations = collectEntries((copywriter.recommendations || []).slice(0, 8), MAX_TEXT_CHARS);
  const prompt = `Профиль стиля:
${JSON.stringify(copywriter.profile || {}, null, 2)}

Методические рекомендации:
${recommendations.texts.length ? recommendations.texts.join("\n\n") : "[не загружены]"}

Работа ИИ:
${aiText}

Идеальная работа человека:
${idealText}

Сравни тексты и извлеки уроки для будущей генерации.`;

  return (await callJson({
    messages: [
      { role: "system", content: LESSON_SYSTEM },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    maxTokens: 1100,
  })) as LessonAnalysis;
}

export async function refineProfile(profile: StyleProfile, lesson: LessonAnalysis) {
  const currentStatus =
    profile.training_status ||
    ({
      ready: false,
      score: 0,
      example_count: 0,
      text_chars: 0,
      required_examples: MIN_READY_EXAMPLES,
      required_text_chars: MIN_READY_TEXT_CHARS,
      recommended_short_posts: RECOMMENDED_SHORT_POSTS,
      used_examples: 0,
      capped: false,
      guidance: ["Статус обучения не рассчитан."],
    } satisfies NonNullable<StyleProfile["training_status"]>);
  const refined = (await callJson({
    messages: [
      { role: "system", content: REFINE_SYSTEM },
      {
        role: "user",
        content: `Текущий профиль:\n${JSON.stringify(profile || {}, null, 2)}\n\nНовый урок:\n${JSON.stringify(
          lesson,
          null,
          2,
        )}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 1500,
  })) as StyleProfile;

  const normalised = normaliseProfile(refined, currentStatus);
  normalised.trained_at = new Date().toISOString();
  return normalised;
}

export function lessonSummary(lesson: StoredLesson) {
  return lesson.analysis.summary || lesson.analysis.prompt_patch || "Правка сохранена";
}
