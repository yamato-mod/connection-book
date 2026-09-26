"use client";
import { useCallback, useEffect, useState } from "react";
import { appFetch } from "@/lib/client-api";

export function useAppData<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await appFetch<T>(path)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "読み込みに失敗しました。"); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { const timer=setTimeout(()=>void reload(),0);return()=>clearTimeout(timer); }, [reload]);
  return { data, error, loading, reload };
}
