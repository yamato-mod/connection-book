"use client";
import { useCallback, useEffect, useState } from "react";
import { appFetch } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/browser";

/**
 * 画面のデータを読み込む。
 * 一度読んだ内容はメモリに覚えておき、タブを切り替えて戻ったときはまずそれを出して、裏で最新を取り直す。
 * （ページを再読み込みすると消える。端末には保存しない。）
 * `loading` は「表示できるデータがまだ無くて読み込み中」のときだけ true。
 */
const cache = new Map<string, unknown>();
let listening = false;

function listenForAccountChanges() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  try {
    // ログアウトや別のアカウントでのログインでは、前の人のデータを出さない。
    createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") cache.clear();
    });
  } catch {
    // Supabaseの設定が無い環境では何もしない
  }
}

export function useAppData<T>(path: string) {
  listenForAccountChanges();
  const [entry, setEntry] = useState<{ path: string; data: T | undefined }>(() => ({ path, data: cache.get(path) as T | undefined }));
  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(true);
  // パスが変わったら、そのパスで覚えている内容に切り替える（描画中に同期する）
  const data = entry.path === path ? entry.data : (cache.get(path) as T | undefined);
  if (entry.path !== path) setEntry({ path, data });

  const reload = useCallback(async () => {
    setFetching(true); setError("");
    try {
      const fresh = await appFetch<T>(path);
      cache.set(path, fresh);
      setEntry({ path, data: fresh });
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "読み込みに失敗しました。"); }
    finally { setFetching(false); }
  }, [path]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);
  return { data, error, loading: fetching && data === undefined, refreshing: fetching, reload };
}

/** よく使う画面のデータを先に読んでおく（まだ覚えていないものだけ）。失敗しても何もしない。 */
export function prefetchAppData(paths: string[]) {
  listenForAccountChanges();
  for (const path of paths) {
    if (cache.has(path)) continue;
    appFetch<unknown>(path).then((data) => { if (!cache.has(path)) cache.set(path, data); }).catch(() => {});
  }
}
