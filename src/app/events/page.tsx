"use client";
import Link from "next/link";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Cloud,
  CloudOff,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { appFetch } from "@/lib/client-api";
import { useAppData } from "@/lib/use-app-data";

/* ── Types matching /api/google/calendar/events GET response ── */
type LocalEvent = {
  id: string;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  is_current: boolean;
  google_calendar_event_id: string | null;
  google_html_link: string | null;
  calendar_source: "app" | "google";
  calendar_sync_status: "local" | "pending" | "synced" | "failed";
  calendar_error: string | null;
  all_day: boolean;
  event_contacts: Array<{ contact: { classification: string } | null }>;
};

type GoogleEvent = {
  googleEventId: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  htmlLink: string | null;
  allDay: boolean;
  updatedAt: string | null;
};

type EventsData = {
  localEvents: LocalEvent[];
  selectedEventId: string | null;
  canManage: boolean;
  calendarConnected: boolean;
  calendarEmail: string | null;
  reconnectRequired: boolean;
  googleEvents: GoogleEvent[];
  calendarError?: string;
};

/* ── Formatting helpers ── */
const fmt = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatRange(start: string, end: string | null, allDay: boolean) {
  if (allDay) {
    return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(
      new Date(start),
    );
  }
  const s = fmt.format(new Date(start));
  if (!end) return s;
  const e = new Intl.DateTimeFormat("ja-JP", { timeStyle: "short" }).format(
    new Date(end),
  );
  return `${s} – ${e}`;
}

/* ── Sync status badge ── */
function SyncBadge({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  if (status === "synced")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#e2f2e8] px-2 py-0.5 text-[10px] font-black text-[#176b45]">
        <CheckCircle2 size={11} />
        同期済み
      </span>
    );
  if (status === "pending")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4dc] px-2 py-0.5 text-[10px] font-black text-[#8b6118]">
        <Loader2 size={11} className="animate-spin" />
        同期中
      </span>
    );
  if (status === "failed")
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-[#fff0ee] px-2 py-0.5 text-[10px] font-black text-[#a93830]"
        title={error ?? undefined}
      >
        <XCircle size={11} />
        同期失敗
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f3f1] px-2 py-0.5 text-[10px] font-black text-[#68746d]">
      <CloudOff size={11} />
      ローカルのみ
    </span>
  );
}

/* ── Main page ── */
export default function EventsPage() {
  const state = useAppData<EventsData>("/api/google/calendar/events");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"local" | "google">("local");

  /* ── Create event via Google Calendar events API ── */
  async function create() {
    setBusy(true);
    setError("");
    try {
      const startsAt = new Date(start).toISOString();
      const endsAt = end
        ? new Date(end).toISOString()
        : new Date(new Date(start).getTime() + 2 * 3600_000).toISOString();
      await appFetch("/api/google/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          name,
          startsAt,
          endsAt,
          location,
          description,
          makeCurrent,
        }),
      });
      setOpen(false);
      setName("");
      setDescription("");
      setStart("");
      setEnd("");
      setLocation("");
      await state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  /* ── Select a local event as current ── */
  async function selectLocal(id: string) {
    setBusy(true);
    setError("");
    try {
      await appFetch("/api/google/calendar/events", {
        method: "POST",
        body: JSON.stringify({ action: "select", localEventId: id }),
      });
      await state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "選択できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  /* ── Import + select a Google Calendar event ── */
  async function selectGoogle(ge: GoogleEvent) {
    setBusy(true);
    setError("");
    try {
      await appFetch("/api/google/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          action: "select",
          googleEvent: {
            googleEventId: ge.googleEventId,
            name: ge.name,
            startsAt: ge.startsAt,
            endsAt: ge.endsAt,
            location: ge.location,
            description: ge.description,
            htmlLink: ge.htmlLink,
            allDay: ge.allDay,
          },
        }),
      });
      await state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "選択できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <LoadingState />;
  if (state.error)
    return <ErrorState message={state.error} retry={state.reload} />;
  const data = state.data;
  if (!data) return <ErrorState message="データを取得できませんでした。" />;

  const localEvents = data.localEvents;
  const googleEvents = data.googleEvents;
  /* Filter Google events that are NOT already imported locally */
  const importedGoogleIds = new Set(
    localEvents
      .map((e) => e.google_calendar_event_id)
      .filter(Boolean) as string[],
  );
  const unimportedGoogleEvents = googleEvents.filter(
    (ge) => !importedGoogleIds.has(ge.googleEventId),
  );

  const counts = (e: LocalEvent) => {
    const c = { important: 0, courtesy: 0, undecided: 0 };
    e.event_contacts.forEach((x) => {
      const key = x.contact?.classification as keyof typeof c;
      if (key in c) c[key]++;
    });
    return c;
  };

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Events</p>
          <h1 className="text-3xl font-black">イベント</h1>
        </div>
        {data.canManage && (
          <button className="btn-primary" onClick={() => setOpen(!open)}>
            <CalendarPlus size={17} />
            新規イベント
          </button>
        )}
      </div>

      {/* ── Calendar connection status ── */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm font-bold">
        {data.calendarConnected ? (
          <>
            <Cloud size={17} className="text-[#176b45]" />
            <span className="text-[#176b45]">
              Googleカレンダー接続済み
            </span>
            <span className="text-xs font-normal text-[#68746d]">
              {data.calendarEmail}
            </span>
          </>
        ) : (
          <>
            <CloudOff size={17} className="text-[#68746d]" />
            <span className="text-[#68746d]">
              Googleカレンダー未接続
            </span>
            <Link
              href="/settings"
              className="text-xs font-bold text-[#176b45]"
            >
              設定で接続 →
            </Link>
          </>
        )}
        {data.reconnectRequired && (
          <span className="rounded-full bg-[#fff4dc] px-2 py-0.5 text-[10px] font-black text-[#8b6118]">
            カレンダー権限を追加するため再接続が必要です →{" "}
            <Link href="/settings" className="underline">
              設定
            </Link>
          </span>
        )}
      </div>
      {data.calendarError && (
        <p className="mt-2 rounded-xl border border-[#dfaaa5] p-3 text-xs font-bold text-[#a93830]">
          {data.calendarError}
        </p>
      )}

      {/* ── Create event form ── */}
      {open && (
        <section className="card mt-4 grid gap-3 p-5">
          <h3 className="font-black">イベントを作成</h3>
          <input
            className="field"
            placeholder="イベント名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="label">
              開始日時
              <input
                className="field"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="label">
              終了日時
              <input
                className="field"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <input
            className="field"
            placeholder="場所"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <textarea
            className="field min-h-16"
            placeholder="説明（任意）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="flex gap-2 text-sm font-bold">
            <input
              type="checkbox"
              checked={makeCurrent}
              onChange={(e) => setMakeCurrent(e.target.checked)}
            />
            作成後、現在のイベントにする
          </label>
          {data.calendarConnected && !data.reconnectRequired && (
            <p className="text-xs text-[#68746d]">
              <Cloud size={12} className="mr-1 inline" />
              Googleカレンダーにも自動登録されます
            </p>
          )}
          <button
            className="btn-primary"
            disabled={busy || !name || !start}
            onClick={create}
          >
            {busy ? "保存中…" : "イベントを作成"}
          </button>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="card mt-3 p-3 text-sm font-bold text-[#a93830]"
        >
          {error}
        </p>
      )}

      {/* ── Tabs: ローカル / Google ── */}
      <div className="mt-6 flex gap-1 rounded-xl bg-[#f1f3f1] p-1">
        <button
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${tab === "local" ? "bg-white shadow-sm" : "text-[#68746d]"}`}
          onClick={() => setTab("local")}
        >
          登録済みイベント
          {localEvents.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-[#68746d]">
              {localEvents.length}
            </span>
          )}
        </button>
        <button
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${tab === "google" ? "bg-white shadow-sm" : "text-[#68746d]"}`}
          onClick={() => setTab("google")}
          disabled={!data.calendarConnected}
          title={
            !data.calendarConnected
              ? "Googleカレンダーが未接続です"
              : undefined
          }
        >
          <Cloud size={14} className="mr-1 inline" />
          Googleカレンダー
          {unimportedGoogleEvents.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-[#68746d]">
              {unimportedGoogleEvents.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Local events tab ── */}
      {tab === "local" && (
        <div className="mt-4 grid gap-4">
          {!localEvents.length ? (
            <EmptyState>
              登録済みのイベントはありません。
              {data.calendarConnected &&
                unimportedGoogleEvents.length > 0 &&
                " Googleカレンダーから取り込むこともできます。"}
            </EmptyState>
          ) : (
            localEvents.map((e) => {
              const c = counts(e);
              const selected = data.selectedEventId === e.id;
              return (
                <article className="card p-5" key={e.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e2f2e8] text-[#176b45]">
                        <CalendarDays />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {selected && (
                            <span className="rounded-full bg-[#176b45] px-2 py-0.5 text-[10px] font-black text-white">
                              現在のイベント
                            </span>
                          )}
                          <SyncBadge
                            status={e.calendar_sync_status}
                            error={e.calendar_error}
                          />
                          {e.calendar_source === "google" && (
                            <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[10px] font-black text-[#3b66a0]">
                              Google取込
                            </span>
                          )}
                        </div>
                        <h2 className="mt-1 text-lg font-black">{e.name}</h2>
                        <p className="text-xs text-[#6e7972]">
                          {formatRange(e.starts_at, e.ends_at, e.all_day)}
                          {e.location && ` · ${e.location}`}
                        </p>
                        {e.description && (
                          <p className="mt-1 text-xs text-[#68746d]">
                            {e.description.slice(0, 120)}
                            {e.description.length > 120 && "…"}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      {!selected && (
                        <button
                          className="btn-secondary py-1 text-xs"
                          disabled={busy}
                          onClick={() => selectLocal(e.id)}
                        >
                          現在のイベントにする
                        </button>
                      )}
                      {e.google_html_link && (
                        <a
                          href={e.google_html_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-[#176b45]"
                        >
                          <ExternalLink size={11} />
                          Googleで開く
                        </a>
                      )}
                    </div>
                  </div>
                  {e.calendar_error && (
                    <p className="mt-2 text-xs text-[#a93830]">
                      同期エラー: {e.calendar_error}
                    </p>
                  )}
                  {/* Stats row */}
                  <div className="mt-5 grid grid-cols-4 gap-2 border-t pt-4 text-center">
                    <div>
                      <Users className="mx-auto" size={17} />
                      <strong className="mt-1 block text-xl">
                        {e.event_contacts.length}
                      </strong>
                      <span className="text-[10px]">交換人数</span>
                    </div>
                    <div>
                      <strong className="block text-xl text-[#8b6118]">
                        {c.important}
                      </strong>
                      <span className="text-[10px]">重要</span>
                    </div>
                    <div>
                      <strong className="block text-xl text-[#176b45]">
                        {c.courtesy}
                      </strong>
                      <span className="text-[10px]">礼儀</span>
                    </div>
                    <div>
                      <strong className="block text-xl text-[#626780]">
                        {c.undecided}
                      </strong>
                      <span className="text-[10px]">判断迷う</span>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {/* ── Google Calendar events tab ── */}
      {tab === "google" && (
        <div className="mt-4 grid gap-4">
          {!data.calendarConnected ? (
            <EmptyState>
              Googleカレンダーが接続されていません。
              <Link
                href="/settings"
                className="ml-1 font-bold text-[#176b45]"
              >
                設定で接続
              </Link>
            </EmptyState>
          ) : !unimportedGoogleEvents.length ? (
            <EmptyState>
              未取込のGoogleカレンダー予定はありません。
              <button
                className="ml-2 inline-flex items-center gap-1 font-bold text-[#176b45]"
                onClick={state.reload}
              >
                <RefreshCw size={13} />
                再読込
              </button>
            </EmptyState>
          ) : (
            <>
              <p className="text-xs font-bold text-[#68746d]">
                Googleカレンダーの予定を「現在のイベント」として取り込めます。取込後は登録済みイベントに表示されます。
              </p>
              {unimportedGoogleEvents.map((ge) => (
                <article className="card p-5" key={ge.googleEventId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#eef4ff] text-[#3b66a0]">
                        <Cloud />
                      </span>
                      <div>
                        <h2 className="text-lg font-black">{ge.name}</h2>
                        <p className="text-xs text-[#6e7972]">
                          {formatRange(ge.startsAt, ge.endsAt, ge.allDay)}
                          {ge.location && ` · ${ge.location}`}
                        </p>
                        {ge.description && (
                          <p className="mt-1 text-xs text-[#68746d]">
                            {ge.description.slice(0, 120)}
                            {ge.description.length > 120 && "…"}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        className="btn-primary py-1 text-xs"
                        disabled={busy}
                        onClick={() => selectGoogle(ge)}
                      >
                        <Link2 size={13} />
                        取り込む
                      </button>
                      {ge.htmlLink && (
                        <a
                          href={ge.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-[#3b66a0]"
                        >
                          <ExternalLink size={11} />
                          Googleで開く
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
