"use client";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Trash2,
  Users,
  X,
  Trophy,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { appFetch } from "@/lib/client-api";
import { useAppData } from "@/lib/use-app-data";

/* ── Types ── */
type EventType = "regular" | "guest" | "external";

type LocalEvent = {
  id: string;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  is_current: boolean;
  all_day: boolean;
  event_type?: EventType;
  event_contacts: Array<{ contact: { classification: string } | null }>;
};

type EventsData = {
  localEvents: LocalEvent[];
  selectedEventId: string | null;
  canManage: boolean;
};

/* ── Constants ── */
const EVENT_TYPE_CONFIG: Record<
  EventType,
  { label: string; bg: string; text: string; dot: string }
> = {
  regular: {
    label: "定例会",
    bg: "bg-[#d4edda]",
    text: "text-[#155724]",
    dot: "bg-[#28a745]",
  },
  guest: {
    label: "ゲスト参加回",
    bg: "bg-[#fff3cd]",
    text: "text-[#856404]",
    dot: "bg-[#ffc107]",
  },
  external: {
    label: "外部イベント",
    bg: "bg-[#f8d7da]",
    text: "text-[#721c24]",
    dot: "bg-[#dc3545]",
  },
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

/* ── Calendar helpers ── */
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatTimeRange(start: string, end: string | null, allDay: boolean) {
  if (allDay) return "終日";
  const s = formatTime(start);
  if (!end) return s;
  return `${s}–${formatTime(end)}`;
}

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

/* ── Event detail modal ── */
function EventDetailModal({
  event,
  isSelected,
  canManage,
  onClose,
  onSelect,
  onDelete,
  busy,
}: {
  event: LocalEvent;
  isSelected: boolean;
  canManage: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const cfg = EVENT_TYPE_CONFIG[event.event_type ?? "regular"];
  const contactCount = event.event_contacts.length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-black ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            {isSelected && (
              <span className="rounded-full bg-[#176b45] px-2 py-0.5 text-[10px] font-black text-white">
                現在のイベント
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-[#f1f3f1]">
            <X size={18} />
          </button>
        </div>
        <h3 className="text-xl font-black">{event.name}</h3>
        <div className="mt-2 space-y-1 text-sm text-[#6e7972]">
          <p className="flex items-center gap-1.5">
            <Clock size={14} />
            {formatRange(event.starts_at, event.ends_at, event.all_day)}
          </p>
          {event.location && (
            <p className="flex items-center gap-1.5">
              <MapPin size={14} />
              {event.location}
            </p>
          )}
        </div>
        {event.description && (
          <p className="mt-3 text-sm text-[#68746d]">{event.description}</p>
        )}
        {contactCount > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-[#176b45]">
            <Users size={14} />
            交換人数: {contactCount}名
          </p>
        )}
        <div className="mt-4 flex gap-2">
          {!isSelected && (
            <button
              className="btn-primary flex-1 py-2 text-sm"
              disabled={busy}
              onClick={() => onSelect(event.id)}
            >
              現在のイベントにする
            </button>
          )}
          {canManage && (
            <button
              className="rounded-xl border border-[#dfaaa5] px-3 py-2 text-sm font-bold text-[#a93830] transition hover:bg-[#fff0ee]"
              disabled={busy}
              onClick={() => {
                if (confirm("このイベントを削除しますか？関連する名刺交換記録も削除されます。"))
                  onDelete(event.id);
              }}
            >
              <Trash2 size={14} className="inline mr-1" />
              削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Calendar event chip (inside day cell) ── */
function CalendarEventChip({
  event,
  onClick,
}: {
  event: LocalEvent;
  onClick: () => void;
}) {
  const cfg = EVENT_TYPE_CONFIG[event.event_type ?? "regular"];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-full rounded-md px-1.5 py-0.5 text-left text-[10px] leading-tight transition hover:opacity-80 ${cfg.bg} ${cfg.text}`}
    >
      <span className="font-bold line-clamp-1">{event.name}</span>
      {event.location && (
        <span className="flex items-center gap-0.5 opacity-80">
          <MapPin size={8} className="shrink-0" />
          <span className="line-clamp-1">{event.location}</span>
        </span>
      )}
      {!event.all_day && (
        <span className="flex items-center gap-0.5 opacity-80">
          <Clock size={8} className="shrink-0" />
          {formatTimeRange(event.starts_at, event.ends_at, event.all_day)}
        </span>
      )}
    </button>
  );
}

/* ── Main page ── */

/* ── ビジコン情報 ── */
type BusinessContest = {
  id: string;
  title: string;
  organizer: string;
  body: string;
  event_date: string | null;
  deadline: string | null;
  url: string;
  is_active: boolean;
  published_at: string;
};

function deadlineLabel(deadline: string | null): { text: string; color: string } | null {
  if (!deadline) return null;
  const now = new Date();
  const dl = new Date(deadline);
  const diff = dl.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: "締切済み", color: "bg-[#e2e2e2] text-[#666]" };
  if (days <= 3) return { text: `あと${days}日`, color: "bg-[#fde8e8] text-[#a93830]" };
  if (days <= 7) return { text: `あと${days}日`, color: "bg-[#fff4dc] text-[#8b6118]" };
  return { text: `あと${days}日`, color: "bg-[#e8f5ee] text-[#176b45]" };
}

function BizconView({ canManage }: { canManage: boolean }) {
  const [showPast, setShowPast] = useState(false);
  const state = useAppData<{ businessContests: BusinessContest[] }>(
    `/api/app?view=business_contests${showPast ? "&showPast=true" : ""}`
  );
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [title, setTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [url, setUrl] = useState("");

  async function createContest() {
    setBusy(true); setError("");
    try {
      await appFetch("/api/app", { method: "POST", body: JSON.stringify({
        action: "create_business_contest", title, organizer, body: description,
        eventDate: eventDate ? new Date(eventDate).toISOString() : null,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        url
      })});
      setShowForm(false); setTitle(""); setOrganizer(""); setDescription("");
      setEventDate(""); setDeadline(""); setUrl("");
      await state.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした。"); }
    finally { setBusy(false); }
  }

  async function deleteContest(id: string) {
    if (!confirm("このビジコン情報を削除しますか？")) return;
    setBusy(true);
    try { await appFetch("/api/app", { method: "POST", body: JSON.stringify({ action: "delete_business_contest", id }) }); await state.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "削除できませんでした。"); }
    finally { setBusy(false); }
  }

  if (state.loading && !state.data) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error} retry={state.reload} />;

  const contests = state.data?.businessContests ?? [];

  return (
    <div className="mt-4 grid gap-4">
      {/* Toggle past items */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-bold text-[#68746d]">
          <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} className="rounded" />
          過去のビジコンも表示
        </label>
        {canManage && (
          <button className="btn-primary text-sm" onClick={() => setShowForm(!showForm)}>
            + ビジコン情報を追加
          </button>
        )}
      </div>

      {showForm && (
        <section className="card grid gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-black">ビジコン情報を追加</h3>
            <button onClick={() => setShowForm(false)} className="rounded-lg p-1 hover:bg-[#f1f3f1]"><X size={18} /></button>
          </div>
          <input className="field" placeholder="大会名" value={title} onChange={e => setTitle(e.target.value)} />
          <input className="field" placeholder="主催" value={organizer} onChange={e => setOrganizer(e.target.value)} />
          <textarea className="field min-h-24" placeholder="概要" value={description} onChange={e => setDescription(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="label">開催日<input className="field" type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} /></label>
            <label className="label">応募締切<input className="field" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
          </div>
          <input className="field" placeholder="URL" value={url} onChange={e => setUrl(e.target.value)} />
          <button className="btn-primary" disabled={busy || !title} onClick={createContest}>{busy ? "保存中…" : "追加"}</button>
          {error && <p className="text-sm font-bold text-[#a93830]">{error}</p>}
        </section>
      )}

      {!contests.length ? (
        <EmptyState>ビジコン情報はまだありません。</EmptyState>
      ) : (
        contests.map(c => {
          const dl = deadlineLabel(c.deadline);
          const eventD = c.event_date ? new Date(c.event_date) : null;
          return (
            <article className="card p-5" key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f0e6ff] text-[#6b3fa0]">
                    <Trophy />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {dl && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${dl.color}`}>
                          {dl.text}
                        </span>
                      )}
                      <h3 className="text-lg font-black">{c.title}</h3>
                    </div>
                    {c.organizer && <p className="mt-0.5 text-sm font-bold text-[#6b3fa0]">{c.organizer}</p>}
                    {c.body && <p className="mt-2 whitespace-pre-wrap text-sm text-[#3a4a3e]">{c.body}</p>}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#68746d]">
                      {eventD && (
                        <span className="flex items-center gap-1">
                          <CalendarDays size={12} />
                          {new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }).format(eventD)}
                        </span>
                      )}
                      {c.deadline && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          締切: {new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(c.deadline))}
                        </span>
                      )}
                    </div>
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-bold text-[#176b45] underline">
                        詳細を見る →
                      </a>
                    )}
                  </div>
                </div>
                {canManage && (
                  <button className="shrink-0 rounded-lg p-2 text-[#a93830] hover:bg-[#fff0ee]" disabled={busy} onClick={() => deleteContest(c.id)}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

export default function EventsPage() {
  const state = useAppData<EventsData>("/api/events");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [eventType, setEventType] = useState<EventType>("regular");
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"calendar" | "list" | "bizcon">("calendar");
  const [selectedEvent, setSelectedEvent] = useState<LocalEvent | null>(null);

  /* Calendar month state */
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  function prevMonth() {
    if (calMonth === 0) {
      setCalYear((y) => y - 1);
      setCalMonth(11);
    } else {
      setCalMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (calMonth === 11) {
      setCalYear((y) => y + 1);
      setCalMonth(0);
    } else {
      setCalMonth((m) => m + 1);
    }
  }
  function goToday() {
    setCalYear(today.getFullYear());
    setCalMonth(today.getMonth());
  }

  /* Build calendar grid */
  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = getFirstDayOfWeek(calYear, calMonth);
    const prevMonthDays = getDaysInMonth(
      calMonth === 0 ? calYear - 1 : calYear,
      calMonth === 0 ? 11 : calMonth - 1,
    );
    const cells: Array<{
      day: number;
      month: number;
      year: number;
      isCurrentMonth: boolean;
    }> = [];

    // Previous month's trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({
        day: prevMonthDays - i,
        month: calMonth === 0 ? 11 : calMonth - 1,
        year: calMonth === 0 ? calYear - 1 : calYear,
        isCurrentMonth: false,
      });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        month: calMonth,
        year: calYear,
        isCurrentMonth: true,
      });
    }
    // Next month's leading days
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        cells.push({
          day: d,
          month: calMonth === 11 ? 0 : calMonth + 1,
          year: calMonth === 11 ? calYear + 1 : calYear,
          isCurrentMonth: false,
        });
      }
    }
    return cells;
  }, [calYear, calMonth]);

  /* ── Create event ── */
  async function create() {
    setBusy(true);
    setError("");
    try {
      const startsAt = new Date(start).toISOString();
      const endsAt = end
        ? new Date(end).toISOString()
        : new Date(new Date(start).getTime() + 2 * 3600_000).toISOString();
      await appFetch("/api/events", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          name,
          startsAt,
          endsAt,
          location,
          description,
          makeCurrent,
          eventType,
        }),
      });
      setOpen(false);
      setName("");
      setDescription("");
      setStart("");
      setEnd("");
      setLocation("");
      setEventType("regular");
      await state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  /* ── Select an event as current ── */
  async function selectLocal(id: string) {
    setBusy(true);
    setError("");
    try {
      await appFetch("/api/events", {
        method: "POST",
        body: JSON.stringify({ action: "select", localEventId: id }),
      });
      await state.reload();
      setSelectedEvent(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "選択できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  /* ── Delete an event ── */
  async function deleteEvent(id: string) {
    setBusy(true);
    setError("");
    try {
      await appFetch("/api/events", {
        method: "POST",
        body: JSON.stringify({ action: "delete", eventId: id }),
      });
      setSelectedEvent(null);
      await state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  /* ── Open create form pre-filled with a date ── */
  function openCreateForDate(year: number, month: number, day: number) {
    if (!data?.canManage) return;
    const d = new Date(year, month, day, 10, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const localStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setStart(localStr);
    const e = new Date(d.getTime() + 2 * 3600_000);
    const endStr = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}T${pad(e.getHours())}:${pad(e.getMinutes())}`;
    setEnd(endStr);
    setOpen(true);
    // scroll to top so form is visible
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (state.loading) return <LoadingState />;
  if (state.error)
    return <ErrorState message={state.error} retry={state.reload} />;
  const data = state.data;
  if (!data) return <ErrorState message="データを取得できませんでした。" />;

  const localEvents = data.localEvents;

  /* Group events by date for calendar */
  const eventsByDate = new Map<string, LocalEvent[]>();
  for (const ev of localEvents) {
    const d = new Date(ev.starts_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const arr = eventsByDate.get(key) ?? [];
    arr.push(ev);
    eventsByDate.set(key, arr);
  }

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
          {/* Event type selector */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(EVENT_TYPE_CONFIG) as [EventType, typeof EVENT_TYPE_CONFIG.regular][]).map(
              ([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEventType(key)}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-bold transition ${
                    eventType === key
                      ? `${cfg.bg} ${cfg.text} border-current`
                      : "border-[#e5e7e5] text-[#68746d]"
                  }`}
                >
                  <span className={`mr-1.5 inline-block size-2.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </button>
              ),
            )}
          </div>
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

      {/* ── View tabs: カレンダー / リスト ── */}
      <div className="mt-6 flex gap-1 rounded-xl bg-[#f1f3f1] p-1">
        <button
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${view === "calendar" ? "bg-white shadow-sm" : "text-[#68746d]"}`}
          onClick={() => setView("calendar")}
        >
          <CalendarDays size={14} className="mr-1 inline" />
          カレンダー
        </button>
        <button
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${view === "list" ? "bg-white shadow-sm" : "text-[#68746d]"}`}
          onClick={() => setView("list")}
        >
          リスト
          {localEvents.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-[#68746d]">
              {localEvents.length}
            </span>
          )}
        </button>
        <button
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${view === "bizcon" ? "bg-white shadow-sm" : "text-[#68746d]"}`}
          onClick={() => setView("bizcon")}
        >
          <Trophy size={14} className="mr-1 inline" />
          ビジコン
        </button>
      </div>

      {/* ── Calendar view ── */}
      {view === "calendar" && (
        <div className="mt-4">
          {/* Month header */}
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={prevMonth}
              className="rounded-lg p-2 hover:bg-[#f1f3f1]"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-center">
              <h2 className="text-xl font-black">
                {MONTH_NAMES[calMonth]} &apos;{String(calYear).slice(2)}
              </h2>
              <p className="text-xs text-[#68746d]">
                {calYear}年{calMonth + 1}月 スケジュール
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={goToday}
                className="rounded-lg px-2 py-1 text-xs font-bold text-[#176b45] hover:bg-[#e2f2e8]"
              >
                今日
              </button>
              <button
                onClick={nextMonth}
                className="rounded-lg p-2 hover:bg-[#f1f3f1]"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="mb-3 flex flex-wrap gap-3 text-xs font-bold">
            {(Object.entries(EVENT_TYPE_CONFIG) as [EventType, typeof EVENT_TYPE_CONFIG.regular][]).map(
              ([key, cfg]) => (
                <span key={key} className="flex items-center gap-1.5">
                  <span className={`size-3 rounded-sm ${cfg.dot}`} />
                  {cfg.label}
                </span>
              ),
            )}
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 border-b border-[#e5e7e5]">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={`py-2 text-center text-xs font-black ${
                  i === 0
                    ? "text-[#dc3545]"
                    : i === 6
                      ? "text-[#007bff]"
                      : "text-[#68746d]"
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 border-l border-[#e5e7e5]">
            {calendarDays.map((cell, idx) => {
              const cellDate = new Date(cell.year, cell.month, cell.day);
              const isToday = isSameDay(cellDate, today);
              const key = `${cell.year}-${cell.month}-${cell.day}`;
              const dayEvents = eventsByDate.get(key) ?? [];
              const dayOfWeek = idx % 7;

              return (
                <div
                  key={idx}
                  className={`min-h-[80px] border-b border-r border-[#e5e7e5] p-1 sm:min-h-[100px] cursor-pointer transition hover:bg-[#f5faf7] ${
                    !cell.isCurrentMonth ? "bg-[#fafafa]" : ""
                  }`}
                  onClick={() => openCreateForDate(cell.year, cell.month, cell.day)}
                >
                  <div
                    className={`mb-0.5 text-right text-xs font-bold ${
                      !cell.isCurrentMonth
                        ? "text-[#ccc]"
                        : isToday
                          ? "inline-flex size-6 items-center justify-center rounded-full bg-[#176b45] text-white ml-auto"
                          : dayOfWeek === 0
                            ? "text-[#dc3545]"
                            : dayOfWeek === 6
                              ? "text-[#007bff]"
                              : "text-[#333]"
                    }`}
                  >
                    {cell.day}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <CalendarEventChip
                        key={ev.id}
                        event={ev}
                        onClick={() => setSelectedEvent(ev)}
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-center text-[9px] font-bold text-[#68746d]">
                        +{dayEvents.length - 3}件
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── List view ── */}
      {view === "list" && (
        <div className="mt-4 grid gap-4">
          {!localEvents.length ? (
            <EmptyState>
              登録済みのイベントはありません。
            </EmptyState>
          ) : (
            localEvents.map((e) => {
              const c = counts(e);
              const selected = data.selectedEventId === e.id;
              const cfg = EVENT_TYPE_CONFIG[e.event_type ?? "regular"];
              return (
                <article className="card p-5" key={e.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${cfg.bg} ${cfg.text}`}>
                        <CalendarDays />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${cfg.bg} ${cfg.text}`}>
                            {cfg.label}
                          </span>
                          {selected && (
                            <span className="rounded-full bg-[#176b45] px-2 py-0.5 text-[10px] font-black text-white">
                              現在のイベント
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
                      {data.canManage && (
                        <button
                          className="rounded-lg border border-[#dfaaa5] px-2 py-1 text-xs font-bold text-[#a93830] transition hover:bg-[#fff0ee]"
                          disabled={busy}
                          onClick={() => {
                            if (confirm("このイベントを削除しますか？関連する名刺交換記録も削除されます。"))
                              deleteEvent(e.id);
                          }}
                        >
                          <Trash2 size={12} className="inline mr-1" />
                          削除
                        </button>
                      )}
                    </div>
                  </div>
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

      {/* ── Event detail modal ── */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          isSelected={data.selectedEventId === selectedEvent.id}
          canManage={data.canManage}
          onClose={() => setSelectedEvent(null)}
          onSelect={selectLocal}
          onDelete={deleteEvent}
          busy={busy}
        />
      )}

      {/* ── ビジコン情報 view ── */}
      {view === "bizcon" && <BizconView canManage={data.canManage} />}

    </div>
  );
}
