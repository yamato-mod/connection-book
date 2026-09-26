"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, CalendarClock, Camera, CheckCircle2, ChevronRight, Inbox, UserRound } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/data-state";
import { useAppData } from "@/lib/use-app-data";

type Dashboard = {
  member: { name: string };
  currentEvent: { id: string; name: string } | null;
  recentContacts: Array<{ id: string; name: string; company_name: string; created_at: string }>;
  tasks: { important: number; undecided: number; today: number; overdue: number };
};

export default function Home() {
  const state = useAppData<Dashboard>("/api/app?view=dashboard");

  if (state.loading) return <LoadingState />;
  if (state.error?.includes("ログイン") || state.error?.includes("所属"))
    return (
      <section className="card mx-auto max-w-lg p-6 text-center">
        <h1 className="text-2xl font-black">つながり帳をはじめる</h1>
        <p className="mt-2 text-sm text-[#68746d]">部員としてログインするか、幹部として新しい団体を作成してください。</p>
        <Link href="/start" className="btn-primary mt-5 w-full">ログイン・団体作成<ArrowRight size={18} /></Link>
      </section>
    );
  if (state.error || !state.data) return <ErrorState message={state.error} retry={state.reload} />;

  const d = state.data;
  const unprocessed = d.tasks.undecided;
  const urgent = d.tasks.important + d.tasks.overdue;
  const todayCount = d.tasks.today;

  return (
    <div className="grid gap-6">
      {/* Header */}
      <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">{new Intl.DateTimeFormat("ja-JP", { dateStyle: "full" }).format(new Date())}</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">
            おかえりなさい、{d.member.name}さん
          </h1>
        </div>
        {d.currentEvent && (
          <div className="flex items-center gap-2 rounded-xl border border-[#dce4de] bg-white px-3 py-2 text-sm">
            <CalendarClock size={15} className="text-[#68746d]" />
            <span className="text-[#68746d]">イベント</span>
            <strong>{d.currentEvent.name}</strong>
          </div>
        )}
      </section>

      {/* Quick Capture — the hero action */}
      <section>
        <Link
          href="/capture?mode=quick"
          className="group flex items-center justify-between rounded-[20px] border-2 border-[#176b45] bg-[#176b45] p-5 text-white active:scale-[.99]"
        >
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-2xl bg-white/20">
              <Camera size={28} />
            </span>
            <span>
              <strong className="block text-2xl font-black">名刺を撮影</strong>
              <span className="text-sm opacity-80">撮って保存、3秒で完了</span>
            </span>
          </div>
          <ArrowRight className="opacity-60 transition-transform group-hover:translate-x-1" />
        </Link>
      </section>

      {/* Status pills */}
      {(unprocessed > 0 || urgent > 0 || todayCount > 0) && (
        <section className="grid gap-3 sm:grid-cols-3">
          {unprocessed > 0 && (
            <Link href="/contacts?filter=undecided" className="flex items-center gap-3 rounded-2xl border border-[#c9cbd9] bg-[#f7f7fb] p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#e8e8f0] text-[#575d78]"><Inbox size={20} /></span>
              <span>
                <strong className="text-2xl font-black text-[#575d78]">{unprocessed}</strong>
                <span className="ml-1 text-xs font-bold text-[#575d78]">未処理の名刺</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-[#575d78] opacity-50" />
            </Link>
          )}
          {urgent > 0 && (
            <Link href="/followups" className="flex items-center gap-3 rounded-2xl border border-[#f0d4a0] bg-[#fff8ec] p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#fff4dc] text-[#8b6118]"><AlertTriangle size={20} /></span>
              <span>
                <strong className="text-2xl font-black text-[#8b6118]">{urgent}</strong>
                <span className="ml-1 text-xs font-bold text-[#8b6118]">要対応</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-[#8b6118] opacity-50" />
            </Link>
          )}
          {todayCount > 0 && (
            <Link href="/followups" className="flex items-center gap-3 rounded-2xl border border-[#afd2bd] bg-[#f1faf4] p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#e2f2e8] text-[#176b45]"><CalendarClock size={20} /></span>
              <span>
                <strong className="text-2xl font-black text-[#176b45]">{todayCount}</strong>
                <span className="ml-1 text-xs font-bold text-[#176b45]">今日のフォロー</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-[#176b45] opacity-50" />
            </Link>
          )}
        </section>
      )}

      {/* Classification cards — only 2 */}
      <section>
        <div className="mb-3">
          <p className="eyebrow">分類して登録</p>
          <h2 className="text-lg font-black">じっくり登録する</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/capture?classification=important"
            className="group flex items-center justify-between rounded-[20px] border-2 border-[#d7c18d] bg-[#fffaf0] p-5 text-[#765518] active:scale-[.99]"
          >
            <div className="flex items-center gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-[#bc8b2c] text-white">
                <BriefcaseBusiness size={25} />
              </span>
              <span>
                <strong className="block text-2xl font-black">重要</strong>
                <span className="text-sm opacity-80">関係構築・個別対応</span>
              </span>
            </div>
            <ArrowRight className="opacity-40" />
          </Link>
          <Link
            href="/capture?classification=courtesy"
            className="group flex items-center justify-between rounded-[20px] border-2 border-[#afd2bd] bg-[#f1faf4] p-5 text-[#176b45] active:scale-[.99]"
          >
            <div className="flex items-center gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-[#218a58] text-white">
                <CheckCircle2 size={25} />
              </span>
              <span>
                <strong className="block text-2xl font-black">礼儀</strong>
                <span className="text-sm opacity-80">編集してお礼メール</span>
              </span>
            </div>
            <ArrowRight className="opacity-40" />
          </Link>
        </div>
      </section>

      {/* Recent contacts */}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">最近登録した人物</h2>
          <Link href="/contacts" className="text-sm font-bold text-[#176b45]">すべて見る</Link>
        </div>
        <div className="grid gap-1">
          {d.recentContacts.length ? d.recentContacts.map(c => (
            <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-[#f4f7f4]">
              <span className="grid size-9 place-items-center rounded-full bg-[#e2f2e8] text-[#176b45]">
                <UserRound size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm">{c.name}</strong>
                <span className="block truncate text-xs text-[#768078]">{c.company_name || "所属未登録"}</span>
              </span>
              <time className="text-[11px] text-[#8a938d]">
                {new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(c.created_at))}
              </time>
            </Link>
          )) : (
            <p className="p-4 text-center text-xs text-[#768078]">登録済みの人物はいません</p>
          )}
        </div>
      </section>
    </div>
  );
}
