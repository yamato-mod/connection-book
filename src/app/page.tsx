"use client";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, ChevronRight, Clock, Inbox, KeyRound, MapPin, Megaphone, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/data-state";
import { appFetch } from "@/lib/client-api";
import { useAppData } from "@/lib/use-app-data";

type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string;
  author: { name: string } | null;
};

type JobPosting = {
  id: string;
  title: string;
  company: string;
  body: string;
  hourly_rate: string;
  location: string;
  deadline: string | null;
  contact_info: string;
  is_active: boolean;
  published_at: string;
  author: { name: string } | null;
};

type BulletinData = {
  member: { name: string; access_role: string };
  canManage: boolean;
  announcements: Announcement[];
  jobPostings: JobPosting[];
  currentEvent: { id: string; name: string; starts_at: string } | null;
  statusSummary: { undecided: number; overdue: number };
  owner2faRequired: boolean;
};

type Tab = "announcements" | "jobs";

export default function Home() {
  const state = useAppData<BulletinData>("/api/app?view=bulletin");
  const [tab, setTab] = useState<Tab>("announcements");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Owner 2FA state
  const [twoFaStep, setTwoFaStep] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [twoFaOtp, setTwoFaOtp] = useState("");
  const [twoFaSessionId, setTwoFaSessionId] = useState("");
  const [twoFaMaskedEmail, setTwoFaMaskedEmail] = useState("");
  const [twoFaError, setTwoFaError] = useState("");

  // Announcement form
  const [showAnnForm, setShowAnnForm] = useState(false);
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annPinned, setAnnPinned] = useState(false);

  // Job form
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobCompany, setJobCompany] = useState("");
  const [jobBody, setJobBody] = useState("");
  const [jobRate, setJobRate] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [jobDeadline, setJobDeadline] = useState("");
  const [jobContact, setJobContact] = useState("");

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
  const manager = d.canManage;

  async function createAnnouncement() {
    setBusy(true); setMessage("");
    try {
      await appFetch("/api/app", { method: "POST", body: JSON.stringify({ action: "create_announcement", title: annTitle, body: annBody, pinned: annPinned }) });
      setShowAnnForm(false); setAnnTitle(""); setAnnBody(""); setAnnPinned(false);
      await state.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : "保存できませんでした。"); } finally { setBusy(false); }
  }

  async function deleteAnnouncement(id: string) {
    if (!confirm("このお知らせを削除しますか？")) return;
    setBusy(true);
    try { await appFetch("/api/app", { method: "POST", body: JSON.stringify({ action: "delete_announcement", id }) }); await state.reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "削除できませんでした。"); } finally { setBusy(false); }
  }

  async function createJobPosting() {
    setBusy(true); setMessage("");
    try {
      await appFetch("/api/app", { method: "POST", body: JSON.stringify({ action: "create_job_posting", title: jobTitle, company: jobCompany, body: jobBody, hourlyRate: jobRate, location: jobLocation, deadline: jobDeadline ? new Date(jobDeadline).toISOString() : null, contactInfo: jobContact }) });
      setShowJobForm(false); setJobTitle(""); setJobCompany(""); setJobBody(""); setJobRate(""); setJobLocation(""); setJobDeadline(""); setJobContact("");
      await state.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : "保存できませんでした。"); } finally { setBusy(false); }
  }

  async function deleteJobPosting(id: string) {
    if (!confirm("このバイト情報を削除しますか？")) return;
    setBusy(true);
    try { await appFetch("/api/app", { method: "POST", body: JSON.stringify({ action: "delete_job_posting", id }) }); await state.reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "削除できませんでした。"); } finally { setBusy(false); }
  }


  async function sendOwner2FA() {
    setTwoFaStep("sending"); setTwoFaError("");
    try {
      const res = await appFetch<{sessionId:string; maskedEmail:string}>("/api/owner-2fa", { method: "POST", body: JSON.stringify({ action: "send_otp" }) });
      setTwoFaSessionId(res.sessionId);
      setTwoFaMaskedEmail(res.maskedEmail);
      setTwoFaStep("sent");
    } catch (e) { setTwoFaError(e instanceof Error ? e.message : "送信に失敗しました。"); setTwoFaStep("idle"); }
  }

  async function verifyOwner2FA() {
    setTwoFaStep("verifying"); setTwoFaError("");
    try {
      await appFetch("/api/owner-2fa", { method: "POST", body: JSON.stringify({ action: "verify_otp", otp: twoFaOtp, sessionId: twoFaSessionId }) });
      await state.reload();
      setTwoFaStep("idle"); setTwoFaOtp("");
    } catch (e) { setTwoFaError(e instanceof Error ? e.message : "認証に失敗しました。"); setTwoFaStep("sent"); }
  }

  // Show 2FA verification screen if required
  if (d.owner2faRequired) {
    return (
      <div className="grid gap-6">
        <section className="card mx-auto max-w-md p-8 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#e8f5ee] text-[#176b45]"><ShieldCheck size={32} /></span>
          <h1 className="mt-4 text-2xl font-black">オーナー認証</h1>
          <p className="mt-2 text-sm text-[#68746d]">セキュリティのため、登録済みの個人メールに認証コードを送信します。</p>
          {twoFaStep === "idle" && (
            <button className="btn-primary mt-6 w-full" onClick={sendOwner2FA}>認証コードを送信</button>
          )}
          {twoFaStep === "sending" && (
            <p className="mt-6 text-sm font-bold text-[#68746d]">送信しています…</p>
          )}
          {(twoFaStep === "sent" || twoFaStep === "verifying") && (
            <div className="mt-6 grid gap-3">
              <p className="text-sm text-[#68746d]">{twoFaMaskedEmail} に認証コードを送信しました。</p>
              <input className="field text-center text-2xl tracking-[.3em]" type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={twoFaOtp} onChange={e => setTwoFaOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              <button className="btn-primary w-full" disabled={twoFaStep === "verifying" || twoFaOtp.length !== 6} onClick={verifyOwner2FA}>{twoFaStep === "verifying" ? "確認中…" : "認証する"}</button>
              <button className="text-sm font-bold text-[#68746d] underline" onClick={sendOwner2FA}>コードを再送信</button>
            </div>
          )}
          {twoFaError && <p className="mt-3 text-sm font-bold text-[#a93830]">{twoFaError}</p>}
          <p className="mt-6 text-xs text-[#68746d]">コードは組織Googleアカウントから送られます。届かないときは迷惑メールフォルダを確認してください。</p>
        </section>
      </div>
    );
  }

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
            <span className="text-[#68746d]">次のイベント</span>
            <strong>{d.currentEvent.name}</strong>
          </div>
        )}
      </section>

      {/* Status summary pills */}
      {(d.statusSummary.undecided > 0 || d.statusSummary.overdue > 0) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {d.statusSummary.undecided > 0 && (
            <Link href="/contacts?filter=undecided" className="flex items-center gap-3 rounded-2xl border border-[#c9cbd9] bg-[#f7f7fb] p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#e8e8f0] text-[#575d78]"><Inbox size={20} /></span>
              <span>
                <strong className="text-2xl font-black text-[#575d78]">{d.statusSummary.undecided}</strong>
                <span className="ml-1 text-xs font-bold text-[#575d78]">未処理の名刺</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-[#575d78] opacity-50" />
            </Link>
          )}
          {d.statusSummary.overdue > 0 && (
            <Link href="/followups" className="flex items-center gap-3 rounded-2xl border border-[#f0d4a0] bg-[#fff8ec] p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#fff4dc] text-[#8b6118]"><AlertTriangle size={20} /></span>
              <span>
                <strong className="text-2xl font-black text-[#8b6118]">{d.statusSummary.overdue}</strong>
                <span className="ml-1 text-xs font-bold text-[#8b6118]">要対応</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-[#8b6118] opacity-50" />
            </Link>
          )}
        </section>
      )}

      {/* Tab switcher: お知らせ / バイト情報 */}
      <div className="flex gap-1 rounded-xl bg-[#f1f3f1] p-1">
        <button className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${tab === "announcements" ? "bg-white shadow-sm" : "text-[#68746d]"}`} onClick={() => setTab("announcements")}>
          <Megaphone size={14} className="mr-1 inline" />お知らせ
          {d.announcements.length > 0 && <span className="ml-1.5 text-xs font-normal text-[#68746d]">{d.announcements.length}</span>}
        </button>
        <button className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${tab === "jobs" ? "bg-white shadow-sm" : "text-[#68746d]"}`} onClick={() => setTab("jobs")}>
          <Briefcase size={14} className="mr-1 inline" />バイト情報
          {d.jobPostings.length > 0 && <span className="ml-1.5 text-xs font-normal text-[#68746d]">{d.jobPostings.length}</span>}
        </button>
      </div>

      {/* Announcements tab */}
      {tab === "announcements" && (
        <div className="grid gap-4">
          {manager && (
            <button className="btn-primary" onClick={() => setShowAnnForm(!showAnnForm)}>
              <Plus size={17} />お知らせを投稿
            </button>
          )}
          {showAnnForm && (
            <section className="card grid gap-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-black">お知らせを投稿</h3>
                <button onClick={() => setShowAnnForm(false)} className="rounded-lg p-1 hover:bg-[#f1f3f1]"><X size={18} /></button>
              </div>
              <input className="field" placeholder="タイトル" value={annTitle} onChange={e => setAnnTitle(e.target.value)} />
              <textarea className="field min-h-24" placeholder="本文" value={annBody} onChange={e => setAnnBody(e.target.value)} />
              <label className="flex gap-2 text-sm font-bold"><input type="checkbox" checked={annPinned} onChange={e => setAnnPinned(e.target.checked)} />ピン留めする</label>
              <button className="btn-primary" disabled={busy || !annTitle || !annBody} onClick={createAnnouncement}>{busy ? "投稿中…" : "投稿"}</button>
            </section>
          )}
          {!d.announcements.length ? (
            <p className="card p-8 text-center text-sm text-[#68746d]">お知らせはまだありません</p>
          ) : (
            d.announcements.map(a => (
              <article key={a.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {a.pinned && <span className="rounded-full bg-[#176b45] px-2 py-0.5 text-[10px] font-black text-white">ピン</span>}
                      <h2 className="text-lg font-black">{a.title}</h2>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[#3a4a3e]">{a.body}</p>
                    <p className="mt-3 text-xs text-[#8a938d]">
                      {a.author?.name ?? "不明"} · {new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).format(new Date(a.published_at))}
                    </p>
                  </div>
                  {manager && (
                    <button className="shrink-0 rounded-lg p-2 text-[#a93830] hover:bg-[#fff0ee]" disabled={busy} onClick={() => deleteAnnouncement(a.id)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {/* Job postings tab */}
      {tab === "jobs" && (
        <div className="grid gap-4">
          {manager && (
            <button className="btn-primary" onClick={() => setShowJobForm(!showJobForm)}>
              <Plus size={17} />バイト情報を投稿
            </button>
          )}
          {showJobForm && (
            <section className="card grid gap-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-black">バイト情報を投稿</h3>
                <button onClick={() => setShowJobForm(false)} className="rounded-lg p-1 hover:bg-[#f1f3f1]"><X size={18} /></button>
              </div>
              <input className="field" placeholder="タイトル" value={jobTitle} onChange={e => setJobTitle(e.target.value)} />
              <input className="field" placeholder="企業名" value={jobCompany} onChange={e => setJobCompany(e.target.value)} />
              <textarea className="field min-h-24" placeholder="詳細" value={jobBody} onChange={e => setJobBody(e.target.value)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="field" placeholder="時給（例: 1,200円〜）" value={jobRate} onChange={e => setJobRate(e.target.value)} />
                <input className="field" placeholder="勤務地" value={jobLocation} onChange={e => setJobLocation(e.target.value)} />
              </div>
              <label className="label">応募締切<input className="field" type="datetime-local" value={jobDeadline} onChange={e => setJobDeadline(e.target.value)} /></label>
              <input className="field" placeholder="連絡先（メールや電話番号など）" value={jobContact} onChange={e => setJobContact(e.target.value)} />
              <button className="btn-primary" disabled={busy || !jobTitle || !jobBody} onClick={createJobPosting}>{busy ? "投稿中…" : "投稿"}</button>
            </section>
          )}
          {!d.jobPostings.length ? (
            <p className="card p-8 text-center text-sm text-[#68746d]">バイト情報はまだありません</p>
          ) : (
            d.jobPostings.map(j => (
              <article key={j.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-black">{j.title}</h2>
                    {j.company && <p className="text-sm font-bold text-[#176b45]">{j.company}</p>}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[#3a4a3e]">{j.body}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#68746d]">
                      {j.hourly_rate && <span className="flex items-center gap-1">💰 {j.hourly_rate}</span>}
                      {j.location && <span className="flex items-center gap-1"><MapPin size={12} />{j.location}</span>}
                      {j.deadline && <span className="flex items-center gap-1"><Clock size={12} />〆切: {new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(j.deadline))}</span>}
                    </div>
                    {j.contact_info && <p className="mt-2 text-xs text-[#68746d]">連絡先: {j.contact_info}</p>}
                    <p className="mt-2 text-xs text-[#8a938d]">
                      {j.author?.name ?? "不明"} · {new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(j.published_at))}
                    </p>
                  </div>
                  {manager && (
                    <button className="shrink-0 rounded-lg p-2 text-[#a93830] hover:bg-[#fff0ee]" disabled={busy} onClick={() => deleteJobPosting(j.id)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {message && <p role="status" className="card p-4 text-sm font-bold">{message}</p>}
    </div>
  );
}
