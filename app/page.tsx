"use client";

import {
  BookOpen,
  Clipboard,
  Database,
  GraduationCap,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  Account,
  Copywriter,
  IncomingFile,
  StoredExample,
  StoredLesson,
  StoredRecommendation,
  StyleProfile,
} from "@/lib/types";

type ApiResponse<T> = T & {
  ok: boolean;
  error?: string;
};

type Health = {
  provider?: string;
  model: string;
  llm_configured: boolean;
  missing_llm_env?: string | null;
  database_configured: boolean;
  database_ok?: boolean;
  database_error?: string;
  access_required?: boolean;
};

type GenerationResult = {
  text?: string;
  style_fit?: string;
  facts_used?: string[];
  region_note?: string;
  warnings?: string[];
};

const MIN_READY_EXAMPLES = 6;
const MIN_READY_TEXT_CHARS = 2500;
const RECOMMENDED_SHORT_POSTS = 10;
const MAX_UPLOAD_FILES = 12;
const MAX_TEXT_FILE_BYTES = 1_500_000;
const MAX_IMAGE_FILE_BYTES = 4_500_000;
const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".html", ".htm"];

const tabs = [
  { id: "base", label: "База стиля", icon: Database },
  { id: "recommendations", label: "Рекомендации", icon: BookOpen },
  { id: "generate", label: "Генерация", icon: Wand2 },
  { id: "lessons", label: "Правки", icon: GraduationCap },
] as const;

const busyLabels: Record<string, string> = {
  access: "проверяем доступ",
  account: "сохраняем аккаунт",
  create: "создаем агента",
  rename: "сохраняем настройки агента",
  examples: "пополняем базу стиля",
  recommendations: "сохраняем рекомендации",
  train: "обучаем профиль стиля",
  generate: "пишем текст",
  lesson: "анализируем правку",
};

type TabId = (typeof tabs)[number]["id"];

class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessError";
  }
}

function storedAccessCode() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("appAccessCode") || "";
}

function saveAccessCode(code: string) {
  window.localStorage.setItem("appAccessCode", code);
  document.cookie = `app_access_code=${encodeURIComponent(code)}; path=/; max-age=2592000; SameSite=Lax`;
}

function clearAccessCode() {
  window.localStorage.removeItem("appAccessCode");
  document.cookie = "app_access_code=; path=/; max-age=0; SameSite=Lax";
}

async function api<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const accessCode = storedAccessCode();
  if (accessCode) headers.set("x-app-access-code", accessCode);

  const response = await fetch(path, {
    ...init,
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  if (!response.ok || data.ok === false) {
    if (response.status === 401) {
      throw new AccessError(data.error || "Введите код доступа администратора.");
    }
    throw new Error(data.error || `Ошибка ${response.status}`);
  }
  return data;
}

function plural(count: number, one: string, few: string, many: string) {
  const last = count % 10;
  const lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return `${count} ${one}`;
  if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(lastTwo)) return `${count} ${few}`;
  return `${count} ${many}`;
}

function shortDate(value?: string) {
  if (!value) return "нет данных";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "нет данных";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function preview(text: string, limit = 220) {
  if (!text) return "Без предпросмотра";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function localTrainingStatus(examples: StoredExample[] = [], profile?: StyleProfile) {
  const textChars = examples.reduce((sum, example) => {
    if (example.text?.trim()) return sum + example.text.trim().length;
    if (example.kind === "image" && example.dataUrl) return sum + 450;
    return sum;
  }, 0);
  const ready = examples.length >= MIN_READY_EXAMPLES && textChars >= MIN_READY_TEXT_CHARS;
  const exampleScore = Math.min(50, Math.round((examples.length / MIN_READY_EXAMPLES) * 50));
  const charScore = Math.min(50, Math.round((textChars / MIN_READY_TEXT_CHARS) * 50));
  const guidance: string[] = [];
  if (examples.length < MIN_READY_EXAMPLES) {
    guidance.push(`Добавьте ещё ${MIN_READY_EXAMPLES - examples.length} материал(а).`);
  }
  if (textChars < MIN_READY_TEXT_CHARS) {
    guidance.push(`Нужно ещё около ${MIN_READY_TEXT_CHARS - textChars} знаков или скриншоты с текстом.`);
  }
  if (examples.length >= MIN_READY_EXAMPLES && examples.length < RECOMMENDED_SHORT_POSTS) {
    guidance.push("Для коротких постов лучше добрать до 10-12 штук.");
  }
  if (!guidance.length) {
    guidance.push("Минимум набран. Можно генерировать рабочие тексты.");
  }
  return {
    ready,
    score: Math.min(100, exampleScore + charScore),
    example_count: examples.length,
    text_chars: textChars,
    required_examples: MIN_READY_EXAMPLES,
    required_text_chars: MIN_READY_TEXT_CHARS,
    recommended_short_posts: RECOMMENDED_SHORT_POSTS,
    used_examples: profile?.training_status?.used_examples || Math.min(examples.length, 24),
    capped: examples.length > 24,
    guidance,
  };
}

function fileToText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isTextFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    TEXT_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

async function readFiles(input: HTMLInputElement | null) {
  const files = Array.from(input?.files || []);
  if (files.length > MAX_UPLOAD_FILES) {
    throw new Error(`Загрузите не больше ${MAX_UPLOAD_FILES} файлов за один раз.`);
  }

  const entries: IncomingFile[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        throw new Error(`Изображение «${file.name}» слишком большое. Сожмите его до 4,5 МБ.`);
      }
      entries.push({ name: file.name, kind: "image", dataUrl: await fileToDataUrl(file) });
    } else {
      if (!isTextFile(file)) {
        throw new Error(`Файл «${file.name}» не похож на текст. Загрузите .txt/.md/.html или скриншот.`);
      }
      if (file.size > MAX_TEXT_FILE_BYTES) {
        throw new Error(`Файл «${file.name}» слишком большой. Разбейте текст на части до 1,5 МБ.`);
      }
      entries.push({ name: file.name, kind: "text", text: await fileToText(file) });
    }
  }
  return entries;
}

function ProfileList({ title, values }: { title: string; values?: unknown }) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return (
    <div className="profile-section">
      <strong>{title}</strong>
      <ul>
        {values.map((value, index) => (
          <li key={`${title}-${index}`}>{String(value)}</li>
        ))}
      </ul>
    </div>
  );
}

function TrainingReadiness({
  status,
  hasProfile,
}: {
  status: ReturnType<typeof localTrainingStatus>;
  hasProfile?: boolean;
}) {
  return (
    <div className={`readiness ${status.ready && hasProfile ? "ready" : "not-ready"}`}>
      <div className="readiness-head">
        <strong>{status.ready && hasProfile ? "Готов к работе" : "Обучение не завершено"}</strong>
        <span>{status.score}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${status.score}%` }} />
      </div>
      <div className="readiness-grid">
        <span>
          Материалы: {status.example_count}/{status.required_examples}
        </span>
        <span>
          Текст: {status.text_chars}/{status.required_text_chars}
        </span>
        <span>Короткие посты: лучше {status.recommended_short_posts}-12</span>
      </div>
      <ul>
        {status.guidance.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
        {!hasProfile && status.ready ? <li>Минимум набран. Нажмите “Обучить”, чтобы сохранить профиль.</li> : null}
      </ul>
    </div>
  );
}

function StyleProfileView({ profile }: { profile: StyleProfile }) {
  if (!profile || Object.keys(profile).length === 0) {
    return <div className="empty-box">Профиль появится после обучения.</div>;
  }

  return (
    <div className="profile-box">
      <div className="profile-section">
        <strong>Сводка</strong>
        <p>{profile.summary || "Без сводки"}</p>
      </div>
      <ProfileList title="Голос" values={profile.voice} />
      <ProfileList title="Структура" values={profile.structure} />
      <ProfileList title="Ритм" values={profile.rhythm} />
      <ProfileList title="Зацепки" values={profile.hooks} />
      <ProfileList title="Лексика" values={profile.vocabulary} />
      <ProfileList title="Делать" values={profile.do} />
      <ProfileList title="Избегать" values={profile.avoid} />
      <ProfileList title="Уроки правок" values={profile.learned_corrections} />
      <div className="profile-section">
        <strong>Инструкция для агента</strong>
        <p>{profile.prompt_addon || "Пока нет."}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessInput, setAccessInput] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [copywriters, setCopywriters] = useState<Copywriter[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Copywriter | null>(null);
  const [tab, setTab] = useState<TabId>("base");
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);
  const [busy, setBusy] = useState("");
  const [syncStatus, setSyncStatus] = useState("синхронизация...");

  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountRole, setAccountRole] = useState("Редактор");
  const [agentName, setAgentName] = useState("");
  const [agentNotes, setAgentNotes] = useState("");
  const [agentOwnerId, setAgentOwnerId] = useState("");
  const [exampleText, setExampleText] = useState("");
  const [exampleFileCount, setExampleFileCount] = useState(0);
  const [recommendationText, setRecommendationText] = useState("");
  const [recommendationFileCount, setRecommendationFileCount] = useState(0);

  const [format, setFormat] = useState("Пост для соцсетей");
  const [platform, setPlatform] = useState("ВКонтакте");
  const [length, setLength] = useState("средний");
  const [theses, setTheses] = useState("");
  const [region, setRegion] = useState("");
  const [skipRegion, setSkipRegion] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceFileCount, setSourceFileCount] = useState(0);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const [aiText, setAiText] = useState("");
  const [idealText, setIdealText] = useState("");

  const exampleFilesRef = useRef<HTMLInputElement | null>(null);
  const recommendationFilesRef = useRef<HTMLInputElement | null>(null);
  const sourceFilesRef = useRef<HTMLInputElement | null>(null);
  const syncVersionRef = useRef(0);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const selectedStats = useMemo(() => {
    const examples = selected?.examples?.length || selected?.example_count || 0;
    const lessons = selected?.lessons?.length || selected?.lesson_count || 0;
    const recommendations = selected?.recommendations?.length || selected?.recommendation_count || 0;
    return { examples, lessons, recommendations };
  }, [selected]);

  const busyLabel = busy ? busyLabels[busy] || "выполняем действие" : "";

  const readiness = useMemo(
    () => localTrainingStatus(selected?.examples || [], selected?.profile),
    [selected?.examples, selected?.profile],
  );

  useEffect(() => {
    setAgentName(selected?.name || "");
    setAgentNotes(selected?.notes || "");
    setAgentOwnerId(selected?.owner_account_id || "");
  }, [selected?.id, selected?.name, selected?.notes, selected?.owner_account_id]);

  useEffect(() => {
    return () => window.clearTimeout(toastTimerRef.current);
  }, []);

  function showToast(message: string, isError = false) {
    window.clearTimeout(toastTimerRef.current);
    setToast(message);
    setToastError(isError);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 4200);
  }

  function showError(error: unknown) {
    const message = error instanceof Error ? error.message : "Ошибка";
    if (error instanceof AccessError) {
      clearAccessCode();
      setAccessCode("");
      setAccessInput("");
      setAccessRequired(true);
      setAccessDenied(true);
    }
    showToast(message, true);
  }

  async function loadHealth() {
    const data = await api<Health>("/api/health");
    setHealth({
      provider: data.provider,
      model: data.model,
      llm_configured: data.llm_configured,
      missing_llm_env: data.missing_llm_env,
      database_configured: data.database_configured,
      database_ok: data.database_ok,
      database_error: data.database_error,
      access_required: data.access_required,
    });
    setAccessRequired(Boolean(data.access_required));
    return data;
  }

  async function loadCopywriters(preferredId?: string) {
    const data = await api<{ copywriters: Copywriter[] }>("/api/copywriters");
    const list = data.copywriters || [];
    setCopywriters(list);
    const saved = preferredId || selectedId || window.localStorage.getItem("selectedCopywriterId") || "";
    const next = list.find((item) => item.id === saved) || list[0];
    if (next) {
      await selectCopywriter(next.id, false);
    } else {
      setSelectedId("");
      setSelected(null);
    }
  }

  async function loadAccounts(preferredId?: string) {
    const data = await api<{ accounts: Account[] }>("/api/accounts");
    const list = data.accounts || [];
    setAccounts(list);
    const saved = preferredId || selectedAccountId || window.localStorage.getItem("selectedAccountId") || "";
    const next = list.find((item) => item.id === saved) || list[0];
    if (next) {
      setSelectedAccountId(next.id);
      window.localStorage.setItem("selectedAccountId", next.id);
    } else {
      setSelectedAccountId("");
      window.localStorage.removeItem("selectedAccountId");
    }
  }

  async function selectCopywriter(id: string, remember = true) {
    const data = await api<{ copywriter: Copywriter }>(`/api/copywriters/${encodeURIComponent(id)}`);
    setSelectedId(id);
    setSelected(data.copywriter);
    if (remember) window.localStorage.setItem("selectedCopywriterId", id);
  }

  async function unlockApp(event: FormEvent) {
    event.preventDefault();
    const code = accessInput.trim();
    if (!code) {
      setAccessDenied(true);
      showToast("Введите код доступа", true);
      return;
    }

    try {
      setBusy("access");
      saveAccessCode(code);
      setAccessCode(code);
      setAccessDenied(false);
      await loadAccounts();
      await loadCopywriters();
      showToast("Доступ открыт");
    } catch (error) {
      clearAccessCode();
      setAccessCode("");
      setAccessDenied(true);
      showError(error);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    const savedAccessCode = storedAccessCode();
    if (savedAccessCode) saveAccessCode(savedAccessCode);
    setAccessCode(savedAccessCode);
    setAccessInput(savedAccessCode);

    loadHealth()
      .then((data) => {
        if (data.access_required && !savedAccessCode) return;
        loadAccounts().catch(showError);
        loadCopywriters().catch(showError);
      })
      .catch(() => setHealth(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (accessRequired && !accessCode) {
      setSyncStatus("нужен код доступа");
      return;
    }

    let source: EventSource | null = null;
    let cancelled = false;
    let reloadTimer: number | undefined;

    async function refreshFromCloud() {
      await loadAccounts().catch(showError);
      await loadCopywriters(selectedId).catch(showError);
    }

    async function connect() {
      try {
        const state = await api<{ version: number }>("/api/sync/state");
        if (cancelled) return;
        syncVersionRef.current = Math.max(syncVersionRef.current, state.version || 0);
        source = new EventSource(`/api/sync/events?after=${syncVersionRef.current}`);
        source.onopen = () => setSyncStatus("облако активно");
        source.onerror = () => setSyncStatus("переподключение...");
        source.addEventListener("sync", (event) => {
          const data = JSON.parse((event as MessageEvent).data || "{}") as { id?: number };
          if (data.id && data.id > syncVersionRef.current) {
            syncVersionRef.current = data.id;
            window.clearTimeout(reloadTimer);
            reloadTimer = window.setTimeout(() => {
              refreshFromCloud();
              setSyncStatus("обновлено из облака");
            }, 250);
          }
        });
        source.addEventListener("reconnect", () => {
          source?.close();
          if (!cancelled) window.setTimeout(connect, 400);
        });
      } catch {
        setSyncStatus("облако недоступно");
        if (!cancelled) window.setTimeout(connect, 2500);
      }
    }

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reloadTimer);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, accessRequired, accessCode]);

  async function createCopywriter(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) {
      showToast("Введите имя копирайтера", true);
      return;
    }
    try {
      setBusy("create");
      const data = await api<{ copywriter: Copywriter }>("/api/copywriters", {
        method: "POST",
        body: JSON.stringify({ name: newName, notes: newNotes, accountId: selectedAccountId }),
      });
      setNewName("");
      setNewNotes("");
      await loadCopywriters(data.copywriter.id);
      showToast("Копирайтер добавлен");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!accountName.trim()) {
      showToast("Введите имя аккаунта", true);
      return;
    }
    try {
      setBusy("account");
      const data = await api<{ account: Account }>("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ name: accountName, email: accountEmail, role: accountRole }),
      });
      setAccountName("");
      setAccountEmail("");
      setAccountRole("Редактор");
      await loadAccounts(data.account.id);
      showToast("Аккаунт добавлен");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function deleteAccount(id: string) {
    if (!window.confirm("Удалить аккаунт сотрудника?")) return;
    try {
      await api(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (selectedAccountId === id) setSelectedAccountId("");
      await loadAccounts("");
      await loadCopywriters(selectedId);
      showToast("Аккаунт удалён");
    } catch (error) {
      showError(error);
    }
  }

  async function renameAgent() {
    if (!selectedId) return;
    try {
      setBusy("rename");
      const data = await api<{ copywriter: Copywriter }>(`/api/copywriters/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: agentName, notes: agentNotes, accountId: agentOwnerId }),
      });
      setSelected(data.copywriter);
      await loadCopywriters(selectedId);
      showToast("Название агента обновлено");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function addExamplesToBase() {
    if (!selectedId) return showToast("Выберите копирайтера", true);
    try {
      setBusy("examples");
      const files = await readFiles(exampleFilesRef.current);
      if (!files.length && !exampleText.trim()) {
        showToast("Добавьте текст или файл", true);
        return;
      }
      await api(`/api/copywriters/${encodeURIComponent(selectedId)}/examples`, {
        method: "POST",
        body: JSON.stringify({ inlineText: exampleText, examples: files }),
      });
      setExampleText("");
      if (exampleFilesRef.current) exampleFilesRef.current.value = "";
      setExampleFileCount(0);
      await selectCopywriter(selectedId);
      await loadCopywriters(selectedId);
      showToast("База пополнена");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function addRecommendationsToBase() {
    if (!selectedId) return showToast("Выберите копирайтера", true);
    try {
      setBusy("recommendations");
      const files = await readFiles(recommendationFilesRef.current);
      if (!files.length && !recommendationText.trim()) {
        showToast("Добавьте текст рекомендации или файл", true);
        return;
      }
      await api(`/api/copywriters/${encodeURIComponent(selectedId)}/recommendations`, {
        method: "POST",
        body: JSON.stringify({ inlineText: recommendationText, recommendations: files }),
      });
      setRecommendationText("");
      if (recommendationFilesRef.current) recommendationFilesRef.current.value = "";
      setRecommendationFileCount(0);
      await selectCopywriter(selectedId);
      await loadCopywriters(selectedId);
      showToast("Рекомендации добавлены");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function trainProfile() {
    if (!selectedId) return;
    try {
      setBusy("train");
      const data = await api<{ copywriter: Copywriter }>(`/api/copywriters/${encodeURIComponent(selectedId)}/train`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSelected(data.copywriter);
      await loadCopywriters(selectedId);
      showToast(readiness.ready ? "Профиль обучен и готов к работе" : "Профиль сохранён, но материалов ещё мало");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function generateText() {
    if (!selectedId) return showToast("Выберите копирайтера", true);
    if (!selected?.has_profile || !readiness.ready) {
      showToast(`Агент ещё не готов: ${readiness.guidance.join(" ")}`, true);
      setTab("base");
      return;
    }
    if (!theses.trim() && !sourceText.trim() && !sourceUrl.trim() && !sourceFilesRef.current?.files?.length) {
      showToast("Добавьте тезисы или источник для нового текста", true);
      return;
    }
    try {
      setBusy("generate");
      setResult(null);
      const sourceFiles = await readFiles(sourceFilesRef.current);
      const data = await api<{ result: GenerationResult }>(`/api/copywriters/${encodeURIComponent(selectedId)}/generate`, {
        method: "POST",
        body: JSON.stringify({
          format,
          platform,
          length,
          theses,
          region,
          skipRegion,
          sourceUrl,
          sourceText,
          sourceFiles,
        }),
      });
      setResult(data.result);
      showToast("Текст готов");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function submitLesson() {
    if (!selectedId) return showToast("Выберите копирайтера", true);
    if (!aiText.trim() || !idealText.trim()) {
      showToast("Добавьте текст ИИ и идеал человека", true);
      return;
    }
    try {
      setBusy("lesson");
      const data = await api<{ copywriter: Copywriter }>(`/api/copywriters/${encodeURIComponent(selectedId)}/lessons`, {
        method: "POST",
        body: JSON.stringify({ aiText, idealText }),
      });
      setSelected(data.copywriter);
      setAiText("");
      setIdealText("");
      await loadCopywriters(selectedId);
      showToast("Правка разобрана, профиль обновлён");
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  }

  async function deleteExample(id: string) {
    if (!window.confirm("Удалить пример из базы?")) return;
    try {
      await api(`/api/examples/${encodeURIComponent(id)}`, { method: "DELETE" });
      await selectCopywriter(selectedId);
      await loadCopywriters(selectedId);
      showToast("Пример удалён");
    } catch (error) {
      showError(error);
    }
  }

  async function deleteLesson(id: string) {
    if (!window.confirm("Удалить урок правки?")) return;
    try {
      await api(`/api/lessons/${encodeURIComponent(id)}`, { method: "DELETE" });
      await selectCopywriter(selectedId);
      await loadCopywriters(selectedId);
      showToast("Правка удалена");
    } catch (error) {
      showError(error);
    }
  }

  async function deleteRecommendation(id: string) {
    if (!window.confirm("Удалить рекомендацию?")) return;
    try {
      await api(`/api/recommendations/${encodeURIComponent(id)}`, { method: "DELETE" });
      await selectCopywriter(selectedId);
      await loadCopywriters(selectedId);
      showToast("Рекомендация удалена");
    } catch (error) {
      showError(error);
    }
  }

  async function deleteSelectedCopywriter() {
    if (!selected) return;
    if (!window.confirm(`Удалить «${selected.name}» со всеми примерами и правками?`)) return;
    try {
      await api(`/api/copywriters/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      window.localStorage.removeItem("selectedCopywriterId");
      setSelected(null);
      setSelectedId("");
      await loadCopywriters("");
      showToast("Копирайтер удалён");
    } catch (error) {
      showError(error);
    }
  }

  if (accessRequired && !accessCode) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={unlockApp}>
          <div className="brand-mark">
            <Lock size={22} />
          </div>
          <div>
            <p className="eyebrow">Закрытый доступ</p>
            <h1>Агент отдела</h1>
            <p className="notes-line">
              Введите код администратора, чтобы открыть базу копирайтеров, правки и генерацию.
            </p>
          </div>
          <label htmlFor="accessCode">Код доступа</label>
          <input
            autoFocus
            id="accessCode"
            type="password"
            value={accessInput}
            onChange={(event) => {
              setAccessInput(event.target.value);
              setAccessDenied(false);
            }}
            placeholder="Введите код"
          />
          {accessDenied ? <p className="field-error">Код не принят. Проверьте значение `APP_ACCESS_CODE`.</p> : null}
          <button className="primary-button" disabled={busy === "access"} type="submit">
            <ShieldCheck size={16} />
            {busy === "access" ? "Проверяю..." : "Войти"}
          </button>
          <div className="health-lines">
            <span>{health?.database_ok ? "База отвечает" : "База не проверена"}</span>
            <span>{health?.llm_configured ? `Нейронка: ${health.provider || ""} ${health.model}` : "Нейронка не настроена"}</span>
          </div>
        </form>
        <div className={`toast ${toast ? "show" : ""} ${toastError ? "error" : ""}`}>{toast}</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>Агент отдела</h1>
            <p>
              {health
                ? `${health.database_ok ? "БД работает" : health.database_configured ? "БД не отвечает" : "нет БД"} · ${
                    health.llm_configured ? `${health.provider || "LLM"}: ${health.model}` : `нет LLM${health.missing_llm_env ? ` (${health.missing_llm_env})` : ""}`
                  } · ${syncStatus}`
                : "проверка сервера"}
            </p>
          </div>
        </div>

        <form className="create-box account-box" onSubmit={createAccount}>
          <label htmlFor="accountName">Аккаунты отдела</label>
          <input
            id="accountName"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder="Имя сотрудника"
          />
          <input
            value={accountEmail}
            onChange={(event) => setAccountEmail(event.target.value)}
            placeholder="email или Telegram"
          />
          <div className="inline-row">
            <select value={accountRole} onChange={(event) => setAccountRole(event.target.value)}>
              <option>Редактор</option>
              <option>Главред</option>
              <option>Маркетолог</option>
              <option>Администратор</option>
            </select>
            <button className="primary-button icon-only" disabled={busy === "account"} type="submit">
              <Plus size={16} />
            </button>
          </div>
          <div className="account-list">
            {accounts.length === 0 ? (
              <span className="muted">Нет аккаунтов</span>
            ) : (
              accounts.map((account) => (
                <div className={`account-item ${account.id === selectedAccountId ? "active" : ""}`} key={account.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      window.localStorage.setItem("selectedAccountId", account.id);
                    }}
                  >
                    <strong>{account.name}</strong>
                    <span>{account.role}</span>
                  </button>
                  <button className="small-danger" onClick={() => deleteAccount(account.id)} type="button">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </form>

        <form className="create-box" onSubmit={createCopywriter}>
          <label htmlFor="newName">Новый копирайтер</label>
          <input
            id="newName"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Имя или роль"
          />
          <textarea
            value={newNotes}
            onChange={(event) => setNewNotes(event.target.value)}
            rows={3}
            placeholder="Ниша, клиенты, ограничения"
          />
          <button className="primary-button" disabled={busy === "create"} type="submit">
            <Plus size={16} />
            {busy === "create" ? "Добавляю..." : "Добавить"}
          </button>
        </form>

        <div className="list-head">
          <span>Копирайтеры</span>
          <button className="icon-button" onClick={() => loadCopywriters().catch(showError)} type="button">
            <RefreshCw size={17} />
          </button>
        </div>

        <div className="copywriter-list">
          {copywriters.length === 0 ? (
            <div className="copywriter-empty">Пока нет профилей</div>
          ) : (
            copywriters.map((copywriter) => (
              <button
                className={`copywriter-item ${copywriter.id === selectedId ? "active" : ""}`}
                key={copywriter.id}
                onClick={() => selectCopywriter(copywriter.id)}
                type="button"
              >
                <span className="copywriter-name">{copywriter.name}</span>
                <span className="copywriter-stats">
                  <span>{plural(copywriter.example_count, "пример", "примера", "примеров")}</span>
                  <span>{plural(copywriter.lesson_count, "правка", "правки", "правок")}</span>
                  <span>{plural(copywriter.recommendation_count, "рекомендация", "рекомендации", "рекомендаций")}</span>
                  <span>{copywriter.has_profile ? "обучен" : "без профиля"}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="workspace">
        <header className="top-panel">
          <div>
            <p className="eyebrow">Профиль замещения</p>
            <h2>{selected?.name || "Выберите копирайтера"}</h2>
            {selected ? (
              <div className="agent-editor">
                <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Название агента" />
                <textarea
                  value={agentNotes}
                  onChange={(event) => setAgentNotes(event.target.value)}
                  rows={2}
                  placeholder="Заметки для отдела"
                />
                <select
                  aria-label="Владелец агента"
                  value={agentOwnerId}
                  onChange={(event) => setAgentOwnerId(event.target.value)}
                >
                  <option value="">Без владельца</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.role}
                    </option>
                  ))}
                </select>
                <button className="secondary-button" disabled={busy === "rename"} onClick={renameAgent} type="button">
                  {busy === "rename" ? "Сохраняю..." : "Сохранить название"}
                </button>
              </div>
            ) : (
              <p className="notes-line">Для отдела можно создать любое количество профилей.</p>
            )}
          </div>
          <div className="top-actions">
            <span className="metric">{plural(selectedStats.examples, "пример", "примера", "примеров")}</span>
            <span className="metric">{plural(selectedStats.lessons, "правка", "правки", "правок")}</span>
            <span className="metric">{plural(selectedStats.recommendations, "рекомендация", "рекомендации", "рекомендаций")}</span>
            <span className="metric">{selected?.has_profile ? "стиль сохранён" : "нужно обучить"}</span>
            <button className="danger-button" disabled={!selected} onClick={deleteSelectedCopywriter} type="button">
              <Trash2 size={16} />
              Удалить
            </button>
          </div>
        </header>

        <nav className="tabs">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`tab ${tab === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => setTab(item.id)}
                type="button"
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="status-row">
          <span className={`status-chip ${health?.database_ok ? "ok" : "warn"}`}>
            {health?.database_ok ? "БД отвечает" : health?.database_configured ? "БД требует проверки" : "БД не подключена"}
          </span>
          <span className={`status-chip ${health?.llm_configured ? "ok" : "warn"}`}>
            {health?.llm_configured ? `${health.provider || "LLM"} · ${health.model}` : `нет нейронки${health?.missing_llm_env ? ` · ${health.missing_llm_env}` : ""}`}
          </span>
          <span className="status-chip">{syncStatus}</span>
          {busyLabel ? (
            <span className="status-chip working">
              <RefreshCw size={14} />
              {busyLabel}
            </span>
          ) : null}
        </div>

        {tab === "base" && (
          <div className="tab-panel">
            <section className="grid two">
              <div className="panel">
                <div className="panel-title">
                  <h3>Пополнение базы</h3>
                  <button
                    className="secondary-button"
                    disabled={!selected || selectedStats.examples === 0 || busy === "train"}
                    onClick={trainProfile}
                    type="button"
                  >
                    <BookOpen size={16} />
                    {busy === "train" ? "Обучаю..." : "Обучить"}
                  </button>
                </div>

                <TrainingReadiness status={readiness} hasProfile={selected?.has_profile} />

                <label htmlFor="exampleText">Текст человека</label>
                <textarea
                  id="exampleText"
                  rows={8}
                  value={exampleText}
                  onChange={(event) => setExampleText(event.target.value)}
                  placeholder="Вставьте реальный текст автора"
                />

                <label htmlFor="exampleFiles">Файлы и изображения</label>
                <input
                  id="exampleFiles"
                  ref={exampleFilesRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json,.html,.htm,image/*"
                  onChange={(event) => setExampleFileCount(event.target.files?.length || 0)}
                />

                <div className="row-actions">
                  <button
                    className="primary-button"
                    disabled={!selected || busy === "examples"}
                    onClick={addExamplesToBase}
                    type="button"
                  >
                    <Plus size={16} />
                    {busy === "examples" ? "Сохраняю..." : "Сохранить в базу"}
                  </button>
                  <span className="muted">{exampleFileCount ? `${exampleFileCount} файл(ов)` : "Файлы не выбраны"}</span>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h3>Профиль стиля</h3>
                  <span className="muted">{shortDate(selected?.profile?.trained_at)}</span>
                </div>
                <StyleProfileView profile={selected?.profile || {}} />
              </div>
            </section>

            <section className="panel">
              <div className="panel-title">
                <h3>Сохранённые примеры</h3>
                <span className="muted">{selectedStats.examples} элементов</span>
              </div>
              <div className="item-list">
                {(selected?.examples || []).length === 0 ? (
                  <div className="empty-box">Добавьте тексты, скриншоты или изображения с работами автора.</div>
                ) : (
                  (selected?.examples || []).map((example: StoredExample) => (
                    <article className="data-item" key={example.id}>
                      <div>
                        <div className="item-title">
                          <span className="badge">{example.kind === "image" ? "картинка" : "текст"}</span>
                          <strong>{example.name}</strong>
                        </div>
                        <p>{example.kind === "image" ? "Изображение с текстом автора" : preview(example.text)}</p>
                      </div>
                      <button className="danger-button" onClick={() => deleteExample(example.id)} type="button">
                        <Trash2 size={16} />
                      </button>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "recommendations" && (
          <div className="tab-panel">
            <section className="grid two">
              <div className="panel">
                <h3>Образование агента</h3>
                <div className="standard-box">
                  <strong>Планка качества</strong>
                  <p>
                    Агент работает как специалист с образованием не ниже бакалавриата журналистики и опытом не менее 5
                    лет в журналистике и копирайтинге. Рекомендации усиливают качество, но не заменяют стиль выбранного
                    автора.
                  </p>
                </div>

                <label htmlFor="recommendationText">Методичка, письмо или правило</label>
                <textarea
                  id="recommendationText"
                  rows={10}
                  value={recommendationText}
                  onChange={(event) => setRecommendationText(event.target.value)}
                  placeholder="Например: выдержки из редакционной политики, письмо главреда, конспект книги"
                />

                <label htmlFor="recommendationFiles">Файлы и изображения</label>
                <input
                  id="recommendationFiles"
                  ref={recommendationFilesRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json,.html,.htm,image/*"
                  onChange={(event) => setRecommendationFileCount(event.target.files?.length || 0)}
                />

                <div className="row-actions">
                  <button
                    className="primary-button"
                    disabled={!selected || busy === "recommendations"}
                    onClick={addRecommendationsToBase}
                    type="button"
                  >
                    <Plus size={16} />
                    {busy === "recommendations" ? "Сохраняю..." : "Добавить рекомендации"}
                  </button>
                  <span className="muted">
                    {recommendationFileCount ? `${recommendationFileCount} файл(ов)` : "Файлы не выбраны"}
                  </span>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h3>Загруженные рекомендации</h3>
                  <span className="muted">{selectedStats.recommendations} элементов</span>
                </div>
                <div className="item-list">
                  {(selected?.recommendations || []).length === 0 ? (
                    <div className="empty-box">
                      Загрузите книги, редакционные правила и письма с рекомендациями. Они будут применяться как
                      профессиональная рамка.
                    </div>
                  ) : (
                    (selected?.recommendations || []).map((item: StoredRecommendation) => (
                      <article className="data-item" key={item.id}>
                        <div>
                          <div className="item-title">
                            <span className="badge">{item.kind === "image" ? "картинка" : "текст"}</span>
                            <strong>{item.name}</strong>
                          </div>
                          <p>{item.kind === "image" ? "Изображение с рекомендацией" : preview(item.text)}</p>
                        </div>
                        <button className="danger-button" onClick={() => deleteRecommendation(item.id)} type="button">
                          <Trash2 size={16} />
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === "generate" && (
          <div className="tab-panel">
            {(!selected?.has_profile || !readiness.ready) && (
              <section className="panel">
                <TrainingReadiness status={readiness} hasProfile={selected?.has_profile} />
              </section>
            )}
            <section className="grid two">
              <div className="panel">
                <h3>Рабочая задача</h3>
                <div className="form-row split">
                  <div>
                    <label htmlFor="format">Формат</label>
                    <select id="format" value={format} onChange={(event) => setFormat(event.target.value)}>
                      <option>Пост для соцсетей</option>
                      <option>Короткая статья</option>
                      <option>Новостная заметка</option>
                      <option>Продающий текст</option>
                      <option>Email-письмо</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="platform">Площадка</label>
                    <select id="platform" value={platform} onChange={(event) => setPlatform(event.target.value)}>
                      <option>ВКонтакте</option>
                      <option>Telegram</option>
                      <option>Сайт</option>
                      <option>Email</option>
                      <option>Универсально</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="length">Длина</label>
                    <select id="length" value={length} onChange={(event) => setLength(event.target.value)}>
                      <option>короткий</option>
                      <option>средний</option>
                      <option>подробный</option>
                    </select>
                  </div>
                </div>

                <label htmlFor="theses">Тезисы</label>
                <textarea
                  id="theses"
                  rows={8}
                  value={theses}
                  onChange={(event) => setTheses(event.target.value)}
                  placeholder="Что обязательно нужно сказать"
                />

                <div className="form-row split align-end">
                  <div>
                    <label htmlFor="region">Регион</label>
                    <input
                      id="region"
                      value={region}
                      onChange={(event) => setRegion(event.target.value)}
                      placeholder="Например: Самара"
                    />
                  </div>
                  <label className="checkline">
                    <input checked={skipRegion} onChange={(event) => setSkipRegion(event.target.checked)} type="checkbox" />
                    <span>Без приземления к региону</span>
                  </label>
                </div>
              </div>

              <div className="panel">
                <h3>Источник</h3>
                <label htmlFor="sourceUrl">Ссылка на статью</label>
                <input
                  id="sourceUrl"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://..."
                  type="url"
                />

                <label htmlFor="sourceText">Текст источника</label>
                <textarea
                  id="sourceText"
                  rows={8}
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  placeholder="Статья, справка, расшифровка"
                />

                <label htmlFor="sourceFiles">Файлы и изображения</label>
                <input
                  id="sourceFiles"
                  ref={sourceFilesRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json,.html,.htm,image/*"
                  onChange={(event) => setSourceFileCount(event.target.files?.length || 0)}
                />

                <div className="row-actions">
                  <button
                    className="primary-button"
                    disabled={!selected || !selected.has_profile || !readiness.ready || busy === "generate"}
                    onClick={generateText}
                    type="button"
                  >
                    <Wand2 size={16} />
                    {busy === "generate" ? "Пишу..." : "Сгенерировать"}
                  </button>
                  <span className="muted">{sourceFileCount ? `${sourceFileCount} файл(ов)` : "Файлы не выбраны"}</span>
                </div>
              </div>
            </section>

            <section className="panel output-panel">
              <div className="panel-title">
                <h3>Готовый текст</h3>
                <div className="button-row">
                  <button
                    className="secondary-button"
                    disabled={!result?.text}
                    onClick={async () => {
                      if (!result?.text) return;
                      try {
                        await navigator.clipboard.writeText(result.text);
                        showToast("Текст скопирован");
                      } catch {
                        showToast("Браузер не дал доступ к буферу обмена", true);
                      }
                    }}
                    type="button"
                  >
                    <Clipboard size={16} />
                    Копировать
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!result?.text}
                    onClick={() => {
                      setAiText(result?.text || "");
                      setTab("lessons");
                    }}
                    type="button"
                  >
                    В правки
                  </button>
                </div>
              </div>
              <textarea readOnly rows={12} value={result?.text || ""} placeholder="Здесь появится результат" />
              {result && (
                <div className="result-meta">
                  <div>
                    <strong>Стиль:</strong> {result.style_fit || "применён профиль выбранного копирайтера"}
                  </div>
                  <div>
                    <strong>Регион:</strong> {result.region_note || "без заметки"}
                  </div>
                  {Boolean(result.facts_used?.length) && (
                    <div>
                      <strong>Факты:</strong> {result.facts_used?.join("; ")}
                    </div>
                  )}
                  {Boolean(result.warnings?.length) && (
                    <div className="warning">
                      <strong>Проверить:</strong> {result.warnings?.join("; ")}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "lessons" && (
          <div className="tab-panel">
            <section className="grid two">
              <div className="panel">
                <h3>Разбор правки</h3>
                <label htmlFor="aiText">Работа ИИ</label>
                <textarea
                  id="aiText"
                  rows={9}
                  value={aiText}
                  onChange={(event) => setAiText(event.target.value)}
                  placeholder="Вставьте текст, который выдал агент"
                />
                <label htmlFor="idealText">Идеал человека</label>
                <textarea
                  id="idealText"
                  rows={9}
                  value={idealText}
                  onChange={(event) => setIdealText(event.target.value)}
                  placeholder="Вставьте финальную версию реального копирайтера"
                />
                <button className="primary-button" disabled={!selected || busy === "lesson"} onClick={submitLesson} type="button">
                  <GraduationCap size={16} />
                  {busy === "lesson" ? "Анализирую..." : "Разобрать и доработать"}
                </button>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h3>Накопленные уроки</h3>
                  <span className="muted">{selectedStats.lessons} элементов</span>
                </div>
                <div className="item-list lessons-list">
                  {(selected?.lessons || []).length === 0 ? (
                    <div className="empty-box">Здесь будут ошибки ИИ и правила, которые агент запомнил.</div>
                  ) : (
                    (selected?.lessons || []).map((lesson: StoredLesson) => (
                      <article className="data-item" key={lesson.id}>
                        <div>
                          <div className="item-title">
                            <span className="badge">{shortDate(lesson.created_at)}</span>
                            <strong>{lesson.analysis.summary || "Правка"}</strong>
                          </div>
                          <p>{lesson.analysis.prompt_patch || lesson.analysis.rules_to_add?.join("; ") || "Урок сохранён"}</p>
                        </div>
                        <button className="danger-button" onClick={() => deleteLesson(lesson.id)} type="button">
                          <Trash2 size={16} />
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </section>

      <div className={`toast ${toast ? "show" : ""} ${toastError ? "error" : ""}`}>{toast}</div>
    </main>
  );
}
