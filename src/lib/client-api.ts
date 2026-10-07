"use client";

import { createClient } from "@/lib/supabase/browser";
import { sha256Fallback } from "@/lib/client-crypto";

export async function appFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const { data: { session } } = await withTimeout(supabase.auth.getSession(), 8_000, "認証サーバーへの接続がタイムアウトしました。Supabase設定を確認してください。");
  if (!session) throw new Error("ログインが必要です。はじめる画面からログインしてください。");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, cache: "no-store", signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("サーバーから応答がありません。Supabase設定と通信状態を確認してください。");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // オーナー認証が済んでいないときは、認証画面のあるホームへ戻す。
    if (payload.error === "owner_2fa_required" && typeof window !== "undefined" && window.location.pathname !== "/") window.location.assign("/");
    throw new Error(payload.message ?? errorMessage(payload.error, response.status));
  }
  return payload as T;
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorMessage(code: string | undefined, status: number) {
  if (status === 401) return "ログインの有効期限が切れました。再ログインしてください。";
  if (code === "member_required") return "このアカウントはまだ団体に所属していません。団体を作成するか、招待を確認してください。";
  if (status === 403) return "この操作を行う権限がありません。";
  if (code === "google_not_configured") return "Google連携が未設定です。管理者がOAuth資格情報を設定してください。";
  return "処理を完了できませんでした。時間をおいて再度お試しください。";
}

export async function sha256Hex(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!globalThis.crypto?.subtle) return sha256Fallback(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
