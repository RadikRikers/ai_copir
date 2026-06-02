import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import { AppError } from "./http";
import type {
  Account,
  Copywriter,
  IncomingFile,
  LessonAnalysis,
  StoredExample,
  StoredLesson,
  StoredRecommendation,
  SyncEvent,
  StyleProfile,
} from "./types";

type Sql = any;

let sqlClient: Sql | null = null;
let schemaReady: Promise<void> | null = null;

const MAX_TEXT_CHARS = 18000;
const MAX_EXAMPLE_CHARS = 6000;
const MAX_IMAGE_CHARS = 8_000_000;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new AppError("DATABASE_URL is not set. Connect Neon Postgres in Vercel or add it to .env.local.", 500);
  }
  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const sql = getSql();
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'Редактор',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS copywriters (
          id TEXT PRIMARY KEY,
          owner_account_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        ALTER TABLE copywriters
        ADD COLUMN IF NOT EXISTS owner_account_id TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS examples (
          id TEXT PRIMARY KEY,
          copywriter_id TEXT NOT NULL REFERENCES copywriters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
          text TEXT NOT NULL DEFAULT '',
          data_url TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_examples_copywriter_id
          ON examples(copywriter_id)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS lessons (
          id TEXT PRIMARY KEY,
          copywriter_id TEXT NOT NULL REFERENCES copywriters(id) ON DELETE CASCADE,
          ai_text TEXT NOT NULL,
          ideal_text TEXT NOT NULL,
          analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_lessons_copywriter_id
          ON lessons(copywriter_id)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS recommendations (
          id TEXT PRIMARY KEY,
          copywriter_id TEXT NOT NULL REFERENCES copywriters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
          text TEXT NOT NULL DEFAULT '',
          data_url TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_recommendations_copywriter_id
          ON recommendations(copywriter_id)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS sync_events (
          id BIGSERIAL PRIMARY KEY,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_sync_events_id
          ON sync_events(id)
      `;
    })();
  }
  return schemaReady;
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function clampText(value: unknown, limit = MAX_TEXT_CHARS) {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .replace(/\n{4,}/g, "\n\n\n");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}\n\n[текст обрезан по лимиту]`;
}

function normaliseDataUrl(value: unknown) {
  const dataUrl = String(value ?? "").trim();
  if (!dataUrl) return "";
  if (!dataUrl.startsWith("data:image/") || !dataUrl.includes(";base64,")) return "";
  if (dataUrl.length > MAX_IMAGE_CHARS) {
    throw new AppError("Одно из изображений слишком большое. Сожмите файл и попробуйте снова.", 413);
  }
  return dataUrl;
}

function parseJson(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toExample(row: Record<string, unknown>): StoredExample {
  return {
    id: String(row.id),
    copywriter_id: String(row.copywriter_id),
    name: String(row.name),
    kind: row.kind === "image" ? "image" : "text",
    text: String(row.text ?? ""),
    dataUrl: String(row.data_url ?? ""),
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

function toLesson(row: Record<string, unknown>): StoredLesson {
  return {
    id: String(row.id),
    copywriter_id: String(row.copywriter_id),
    ai_text: String(row.ai_text ?? ""),
    ideal_text: String(row.ideal_text ?? ""),
    analysis: parseJson(row.analysis_json) as LessonAnalysis,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

function toRecommendation(row: Record<string, unknown>): StoredRecommendation {
  return {
    id: String(row.id),
    copywriter_id: String(row.copywriter_id),
    name: String(row.name),
    kind: row.kind === "image" ? "image" : "text",
    text: String(row.text ?? ""),
    dataUrl: String(row.data_url ?? ""),
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

function toCopywriter(row: Record<string, unknown>): Copywriter {
  const profile = parseJson(row.profile_json) as StyleProfile;
  return {
    id: String(row.id),
    owner_account_id: String(row.owner_account_id ?? ""),
    name: String(row.name),
    notes: String(row.notes ?? ""),
    profile,
    has_profile: Object.keys(profile).length > 0,
    example_count: Number(row.example_count ?? 0),
    lesson_count: Number(row.lesson_count ?? 0),
    recommendation_count: Number(row.recommendation_count ?? 0),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

function toAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email ?? ""),
    role: String(row.role ?? "Редактор"),
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

function toSyncEvent(row: Record<string, unknown>): SyncEvent {
  return {
    id: Number(row.id),
    entity: String(row.entity),
    entity_id: String(row.entity_id ?? ""),
    action: String(row.action),
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

export async function emitSyncEvent(entity: string, entityId: string, action: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO sync_events (entity, entity_id, action)
    VALUES (${entity}, ${entityId}, ${action})
  `;
}

export async function latestSyncVersion() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT COALESCE(MAX(id), 0)::bigint AS version FROM sync_events`;
  return Number(rows[0]?.version || 0);
}

export async function syncEventsAfter(after: number) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM sync_events
    WHERE id > ${after}
    ORDER BY id ASC
    LIMIT 50
  `;
  return rows.map((row: Record<string, unknown>) => toSyncEvent(row));
}

export async function listAccounts() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM accounts
    ORDER BY created_at DESC
  `;
  return rows.map((row: Record<string, unknown>) => toAccount(row));
}

export async function createAccount(body: Record<string, unknown>) {
  await ensureSchema();
  const name = clampText(body.name, 160);
  const email = clampText(body.email, 240);
  const role = clampText(body.role || "Редактор", 120);
  if (!name) throw new AppError("Введите имя аккаунта.");
  const accountId = id("acc");
  const sql = getSql();
  const rows = await sql`
    INSERT INTO accounts (id, name, email, role)
    VALUES (${accountId}, ${name}, ${email}, ${role})
    RETURNING *
  `;
  await emitSyncEvent("account", accountId, "create");
  return toAccount(rows[0]);
}

export async function deleteAccount(accountId: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`DELETE FROM accounts WHERE id = ${accountId} RETURNING id`;
  if (!rows[0]) throw new AppError("Аккаунт не найден.", 404);
  await sql`
    UPDATE copywriters
    SET owner_account_id = ''
    WHERE owner_account_id = ${accountId}
  `;
  await emitSyncEvent("account", accountId, "delete");
}

export async function listCopywriters() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      c.*,
      (SELECT COUNT(*)::int FROM examples e WHERE e.copywriter_id = c.id) AS example_count,
      (SELECT COUNT(*)::int FROM lessons l WHERE l.copywriter_id = c.id) AS lesson_count,
      (SELECT COUNT(*)::int FROM recommendations r WHERE r.copywriter_id = c.id) AS recommendation_count
    FROM copywriters c
    ORDER BY c.updated_at DESC
  `;
  return rows.map((row: Record<string, unknown>) => toCopywriter(row));
}

export async function getCopywriter(copywriterId: string, includeChildren = true) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      c.*,
      (SELECT COUNT(*)::int FROM examples e WHERE e.copywriter_id = c.id) AS example_count,
      (SELECT COUNT(*)::int FROM lessons l WHERE l.copywriter_id = c.id) AS lesson_count,
      (SELECT COUNT(*)::int FROM recommendations r WHERE r.copywriter_id = c.id) AS recommendation_count
    FROM copywriters c
    WHERE c.id = ${copywriterId}
    LIMIT 1
  `;
  if (!rows[0]) throw new AppError("Копирайтер не найден.", 404);
  const copywriter = toCopywriter(rows[0]);
  if (includeChildren) {
    const examples = await sql`
      SELECT * FROM examples
      WHERE copywriter_id = ${copywriterId}
      ORDER BY created_at DESC
    `;
    const lessons = await sql`
      SELECT * FROM lessons
      WHERE copywriter_id = ${copywriterId}
      ORDER BY created_at DESC
      LIMIT 20
    `;
    const recommendations = await sql`
      SELECT * FROM recommendations
      WHERE copywriter_id = ${copywriterId}
      ORDER BY created_at DESC
      LIMIT 30
    `;
    copywriter.examples = examples.map((row: Record<string, unknown>) => toExample(row));
    copywriter.lessons = lessons.map((row: Record<string, unknown>) => toLesson(row));
    copywriter.recommendations = recommendations.map((row: Record<string, unknown>) => toRecommendation(row));
  }
  return copywriter;
}

export async function createCopywriter(body: Record<string, unknown>) {
  await ensureSchema();
  const name = clampText(body.name, 160);
  const notes = clampText(body.notes, 1200);
  const ownerAccountId = clampText(body.accountId, 120);
  if (!name) throw new AppError("Введите имя копирайтера.");

  const sql = getSql();
  const copywriterId = id("cw");
  await sql`
    INSERT INTO copywriters (id, owner_account_id, name, notes)
    VALUES (${copywriterId}, ${ownerAccountId}, ${name}, ${notes})
  `;
  await emitSyncEvent("copywriter", copywriterId, "create");
  return getCopywriter(copywriterId);
}

export async function updateCopywriter(copywriterId: string, body: Record<string, unknown>) {
  await ensureSchema();
  const current = await getCopywriter(copywriterId, false);
  const name = clampText(body.name ?? current.name, 160);
  const notes = clampText(body.notes ?? current.notes, 1200);
  const ownerAccountId = clampText(body.accountId ?? current.owner_account_id ?? "", 120);
  if (!name) throw new AppError("Название агента не может быть пустым.");
  const sql = getSql();
  const rows = await sql`
    UPDATE copywriters
    SET name = ${name},
        notes = ${notes},
        owner_account_id = ${ownerAccountId},
        updated_at = NOW()
    WHERE id = ${copywriterId}
    RETURNING id
  `;
  if (!rows[0]) throw new AppError("Копирайтер не найден.", 404);
  await emitSyncEvent("copywriter", copywriterId, "update");
  return getCopywriter(copywriterId);
}

export async function deleteCopywriter(copywriterId: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`DELETE FROM copywriters WHERE id = ${copywriterId} RETURNING id`;
  if (!rows[0]) throw new AppError("Копирайтер не найден.", 404);
  await emitSyncEvent("copywriter", copywriterId, "delete");
}

export async function addExamples(copywriterId: string, body: Record<string, unknown>) {
  await getCopywriter(copywriterId, false);
  const rawEntries = Array.isArray(body.examples) ? (body.examples as IncomingFile[]) : [];
  const inlineText = clampText(body.inlineText, MAX_TEXT_CHARS);
  const entries: IncomingFile[] = inlineText
    ? [{ name: "Вставленный текст", kind: "text", text: inlineText }, ...rawEntries]
    : rawEntries;
  if (!entries.length) throw new AppError("Добавьте текст, файл или изображение для базы.");

  const sql = getSql();
  const saved: StoredExample[] = [];
  for (const [index, entry] of entries.entries()) {
    const name = clampText(entry.name || `Пример ${index + 1}`, 180);
    const text = clampText(entry.text, MAX_EXAMPLE_CHARS);
    const dataUrl = normaliseDataUrl(entry.dataUrl);
    if (!text && !dataUrl) continue;
    const kind = dataUrl ? "image" : "text";
    const exampleId = id("ex");
    const rows = await sql`
      INSERT INTO examples (id, copywriter_id, name, kind, text, data_url)
      VALUES (${exampleId}, ${copywriterId}, ${name}, ${kind}, ${text}, ${dataUrl})
      RETURNING *
    `;
    saved.push(toExample(rows[0]));
  }

  if (!saved.length) throw new AppError("Не нашёл данных для сохранения. Проверьте файлы или текст.");
  await touchCopywriter(copywriterId);
  await emitSyncEvent("copywriter", copywriterId, "examples");
  return saved;
}

export async function deleteExample(exampleId: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`DELETE FROM examples WHERE id = ${exampleId} RETURNING copywriter_id`;
  if (!rows[0]) throw new AppError("Пример не найден.", 404);
  await touchCopywriter(String(rows[0].copywriter_id));
  await emitSyncEvent("copywriter", String(rows[0].copywriter_id), "examples");
}

export async function saveProfile(copywriterId: string, profile: StyleProfile) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE copywriters
    SET profile_json = ${JSON.stringify(profile)}::jsonb,
        updated_at = NOW()
    WHERE id = ${copywriterId}
    RETURNING id
  `;
  if (!rows[0]) throw new AppError("Копирайтер не найден.", 404);
  await emitSyncEvent("copywriter", copywriterId, "profile");
}

export async function addLesson(
  copywriterId: string,
  aiText: string,
  idealText: string,
  analysis: LessonAnalysis,
) {
  await getCopywriter(copywriterId, false);
  const sql = getSql();
  const lessonId = id("lsn");
  const rows = await sql`
    INSERT INTO lessons (id, copywriter_id, ai_text, ideal_text, analysis_json)
    VALUES (${lessonId}, ${copywriterId}, ${aiText}, ${idealText}, ${JSON.stringify(analysis)}::jsonb)
    RETURNING *
  `;
  await touchCopywriter(copywriterId);
  await emitSyncEvent("copywriter", copywriterId, "lesson");
  return toLesson(rows[0]);
}

export async function deleteLesson(lessonId: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`DELETE FROM lessons WHERE id = ${lessonId} RETURNING copywriter_id`;
  if (!rows[0]) throw new AppError("Правка не найдена.", 404);
  await touchCopywriter(String(rows[0].copywriter_id));
  await emitSyncEvent("copywriter", String(rows[0].copywriter_id), "lesson");
}

export async function addRecommendations(copywriterId: string, body: Record<string, unknown>) {
  await getCopywriter(copywriterId, false);
  const rawEntries = Array.isArray(body.recommendations) ? (body.recommendations as IncomingFile[]) : [];
  const inlineText = clampText(body.inlineText, MAX_TEXT_CHARS);
  const entries: IncomingFile[] = inlineText
    ? [{ name: "Вставленная рекомендация", kind: "text", text: inlineText }, ...rawEntries]
    : rawEntries;
  if (!entries.length) throw new AppError("Добавьте текст, файл или изображение с рекомендацией.");

  const sql = getSql();
  const saved: StoredRecommendation[] = [];
  for (const [index, entry] of entries.entries()) {
    const name = clampText(entry.name || `Рекомендация ${index + 1}`, 180);
    const text = clampText(entry.text, MAX_EXAMPLE_CHARS);
    const dataUrl = normaliseDataUrl(entry.dataUrl);
    if (!text && !dataUrl) continue;
    const kind = dataUrl ? "image" : "text";
    const recommendationId = id("rec");
    const rows = await sql`
      INSERT INTO recommendations (id, copywriter_id, name, kind, text, data_url)
      VALUES (${recommendationId}, ${copywriterId}, ${name}, ${kind}, ${text}, ${dataUrl})
      RETURNING *
    `;
    saved.push(toRecommendation(rows[0]));
  }

  if (!saved.length) throw new AppError("Не нашёл данных для сохранения. Проверьте файлы или текст.");
  await touchCopywriter(copywriterId);
  await emitSyncEvent("copywriter", copywriterId, "recommendations");
  return saved;
}

export async function deleteRecommendation(recommendationId: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`DELETE FROM recommendations WHERE id = ${recommendationId} RETURNING copywriter_id`;
  if (!rows[0]) throw new AppError("Рекомендация не найдена.", 404);
  await touchCopywriter(String(rows[0].copywriter_id));
  await emitSyncEvent("copywriter", String(rows[0].copywriter_id), "recommendations");
}

async function touchCopywriter(copywriterId: string) {
  const sql = getSql();
  await sql`UPDATE copywriters SET updated_at = NOW() WHERE id = ${copywriterId}`;
}
