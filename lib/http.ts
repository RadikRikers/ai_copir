import { NextResponse } from "next/server";

export class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function ok<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function fail(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export function requireAccess(request: Request) {
  const expected = process.env.APP_ACCESS_CODE?.trim();
  if (!expected) return;

  const url = new URL(request.url);
  const cookieCode = (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("app_access_code="))
    ?.slice("app_access_code=".length);
  let decodedCookieCode = "";
  try {
    decodedCookieCode = cookieCode ? decodeURIComponent(cookieCode) : "";
  } catch {
    decodedCookieCode = "";
  }
  const provided =
    request.headers.get("x-app-access-code") ||
    decodedCookieCode ||
    url.searchParams.get("access") ||
    "";
  if (provided.trim() !== expected) {
    throw new AppError("Введите код доступа администратора.", 401);
  }
}

export async function jsonBody(request: Request) {
  try {
    const data = await request.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new AppError("Expected JSON object.");
    }
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Could not read JSON body.");
  }
}
