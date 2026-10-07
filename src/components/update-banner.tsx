"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 新しいバージョンがデプロイされたら、画面下に「更新があります」を出す。
 * アプリを開き直したとき・5分ごと・画面に戻ってきたときに確認する。
 */
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (CURRENT === "dev") return;
    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const { version } = (await response.json()) as { version?: string };
        if (version && version !== "dev" && version !== CURRENT) setAvailable(true);
      } catch {
        // 通信できないときは何もしない
      }
    }
    const first = setTimeout(check, 3000);
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!available) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex items-center gap-2 rounded-full bg-[#176b45] px-5 py-3 text-sm font-black text-white shadow-lg"
      >
        <RefreshCw size={16} />
        新しいバージョンがあります・タップで更新
      </button>
    </div>
  );
}
