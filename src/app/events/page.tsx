"use client";
import Link from "next/link";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  Clock,
  RefreshCw,
  Users,
  XCircle,
  X,
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
  google_calendar_event_id: string | null;
  google_html_link: string | null;
  calendar_source: "app" | "google";
  calendar_sync_status: "local" | "pending" | "synced" | "failed";
  calendar_error: string | null;
  all_day: boolean;
  event_type?: EventType;
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

/* ── Event detail modal ── */
function EventDetailModal({
  event,
  isSelected,
  onClose,
  onSelect,
  busy,
}: {
  event: LocalEvent;
  isSelected: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
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
            <SyncBadge status={event.calendar_sync_status} error={event.calendar_error} />
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
          {event.google_html_link && (
            <a
              href={event.google_html_link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary inline-flex items-center gap-1 py-2 text-sm"
            >
              <ExternalLink size={13} />
              Googleで開く
            </a>
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
      onClick={onClick}
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
export default function EventsPage() {
  const state = useAppData<EventsData>("/api/google/calendar/events");
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
  const [view, setView] = useState<"calendar" | "list" | "google">("calendar");
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
      setSelectedEvent(null);
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
  const importedGoogleIds = new Set(
    localEvents
      .map((e) => e.google_calendar_event_id)
      .filter(Boolean) as string[],
  );
  const unimportedGoogleEvents = googleEvents.filter(
    (ge) => !importedGoogleIds.has(ge.googleEventId),
  );

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

      {/* ── View tabs: カレンダー / リスト / Google ── */}
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
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-black transition ${view === "google" ? "bg-white shadow-sm" : "text-[#68746d]"}`}
          onClick={() => setView("google")}
          disabled={!data.calendarConnected}
          title={
            !data.calendarConnected
              ? "Googleカレンダーが未接続です"
              : undefined
          }
        >
          <Cloud size={14} className="mr-1 inline" />
          Google
          {unimportedGoogleEvents.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-[#68746d]">
              {unimportedGoogleEvents.length}
            </span>
          )}
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
                  className={`min-h-[80px] border-b border-r border-[#e5e7e5] p-1 sm:min-h-[100px] ${
                    !cell.isCurrentMonth ? "bg-[#fafafa]" : ""
                  }`}
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

      {/* ── List view (local events) ── */}
      {view === "list" && (
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
      {view === "google" && (
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

      {/* ── Event detail modal ── */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          isSelected={data.selectedEventId === selectedEvent.id}
          onClose={() => setSelectedEvent(null)}
          onSelect={selectLocal}
          busy={busy}
        />
      )}
    </div>
  );
}
