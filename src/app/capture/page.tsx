"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, FilePenLine, Inbox, Mail, Zap } from "lucide-react";
import { CaptureWizard } from "@/components/capture-wizard";
import { useAppData } from "@/lib/use-app-data";

type CaptureMode = "quick" | "important" | "courtesy";

function ModeSelector({ onSelect }: { onSelect: (mode: CaptureMode) => void }) {
  const state = useAppData<{ statusSummary: { undecided: number; overdue: number } }>("/api/app?view=bulletin");
  const summary = state.data?.statusSummary;

  return (
    <div className="grid gap-6">
      <section>
        <h1 className="text-2xl font-black tracking-tight">名刺を撮影する</h1>
        <p className="mt-1 text-sm text-[#68746d]">撮影モードを選んでスタート</p>
      </section>

      {summary && (summary.undecided > 0 || summary.overdue > 0) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {summary.undecided > 0 && (
            <Link href="/contacts?filter=undecided" className="flex items-center gap-3 rounded-2xl border border-[#c9cbd9] bg-[#f7f7fb] p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#e8e8f0] text-[#575d78]"><Inbox size={20} /></span>
              <span>
                <strong className="text-2xl font-black text-[#575d78]">{summary.undecided}</strong>
                <span className="ml-1 text-xs font-bold text-[#575d78]">未処理の名刺</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-[#575d78] opacity-50" />
            </Link>
          )}
          {summary.overdue > 0 && (
            <Link href="/followups" className="flex items-center gap-3 rounded-2xl border border-[#f0d4a0] bg-[#fff8ec] p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#fff4dc] text-[#8b6118]"><AlertTriangle size={20} /></span>
              <span>
                <strong className="text-2xl font-black text-[#8b6118]">{summary.overdue}</strong>
                <span className="ml-1 text-xs font-bold text-[#8b6118]">要対応</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-[#8b6118] opacity-50" />
            </Link>
          )}
        </section>
      )}

      <section className="grid gap-3">
        <button onClick={() => onSelect("quick")} className="card flex items-center gap-4 p-5 text-left transition hover:shadow-md">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e8f5ee] text-[#176b45]"><Zap size={24} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-black">保存のみ（クイック）</h2>
            <p className="mt-0.5 text-xs text-[#68746d]">名刺を撮影して素早く保存。メール下書きなし。</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-[#68746d] opacity-50" />
        </button>

        <button onClick={() => onSelect("important")} className="card flex items-center gap-4 p-5 text-left transition hover:shadow-md">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#fff1d1] text-[#805813]"><FilePenLine size={24} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-black">保存＋下書き作成（重要）</h2>
            <p className="mt-0.5 text-xs text-[#68746d]">名刺を保存し、お礼メールの下書きを作成します。</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-[#68746d] opacity-50" />
        </button>

        <button onClick={() => onSelect("courtesy")} className="card flex items-center gap-4 p-5 text-left transition hover:shadow-md">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e2f2e8] text-[#176b45]"><Mail size={24} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-black">保存＋お礼送信（礼儀）</h2>
            <p className="mt-0.5 text-xs text-[#68746d]">名刺を保存し、その場でお礼メールを送信します。</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-[#68746d] opacity-50" />
        </button>
      </section>
    </div>
  );
}

export default function CapturePage() {
  const [mode, setMode] = useState<CaptureMode | null>(null);

  if (mode === null) {
    return <ModeSelector onSelect={setMode} />;
  }

  return (
    <div>
      <button onClick={() => setMode(null)} className="mb-4 flex items-center gap-1 text-sm font-bold text-[#68746d] hover:text-[#3a4a3e]">
        ← モード選択に戻る
      </button>
      <Suspense fallback={<div className="card p-8 text-center">撮影画面を準備しています…</div>}>
        <CaptureWizard key={mode} captureMode={mode} />
      </Suspense>
    </div>
  );
}
