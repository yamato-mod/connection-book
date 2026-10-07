"use client";
import { useState } from "react";
import { BookUser, Check, KeyRound, UserPlus, Users, X } from "lucide-react";
import { assignablePositions, positionLabel, statusLabel, type MemberStatus, type Position } from "@/lib/membership";

export type RosterMember = {
  id: string; name: string; role: string; access_role: "owner" | "admin" | "member"; position: Position; status: MemberStatus;
  status_reason: string; suspended_until: string | null; joined_at: string | null; left_at: string | null; created_at: string;
  contact_email: string; library_access: boolean;
};
export type LibraryRequest = { id: string; member_id: string; reason: string; created_at: string };
type Props = {
  me: { id: string; access_role: string };
  members: RosterMember[];
  libraryRequests: LibraryRequest[];
  canSuspend: boolean;
  busy: boolean;
  mutate: (body: object) => Promise<void>;
};
type Pending = { id: string; kind: "suspend" | "withdraw" | "reject" | "leave"; reason: string; days: number };

const date = (value: string | null) => (value ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeZone: "Asia/Tokyo" }).format(new Date(value)) : "—");
const statusTone: Record<MemberStatus, string> = { pending: "bg-[#fff6df] text-[#a25c00]", active: "bg-[#e2f2e8] text-[#176b45]", on_leave: "bg-[#eef1f6] text-[#4a5568]", suspended: "bg-[#fff0ee] text-[#a93830]", withdrawn: "bg-[#f3f3f3] text-[#7a7a7a]" };

/**
 * 部員名簿（規約第12条）と、入部承認（第7条）・休部（第10条）・退部（第11条）・活動停止（第35・36条）・
 * 役職（第13条）・名刺ライブラリの閲覧権限をまとめて扱う管理画面。
 */
export function MemberRoster({ me, members, libraryRequests, canSuspend, busy, mutate }: Props) {
  const owner = me.access_role === "owner";
  const [pending, setPending] = useState<Pending | null>(null);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const byId = new Map(members.map((m) => [m.id, m]));
  const applicants = members.filter((m) => m.status === "pending");
  const roster = members.filter((m) => m.status !== "pending" && (showWithdrawn || m.status !== "withdrawn"));
  const canActOn = (m: RosterMember) => m.id !== me.id && m.access_role !== "owner" && (owner || m.access_role === "member");
  const run = async (body: object) => { await mutate(body); setPending(null); };

  return <section className="card p-5 lg:col-span-2">
    <h2 className="flex items-center gap-2 font-black"><Users />部員名簿・権限</h2>
    <p className="mt-1 text-xs text-[#68746d]">規約に基づく名簿です。入部は承認制、退部するとGoogle連携・端末・名刺の閲覧権限が自動で外れます。</p>

    {applicants.length > 0 && <div className="mt-4 rounded-2xl border-2 border-[#dc9b35] bg-[#fff6df] p-4">
      <h3 className="flex items-center gap-2 text-sm font-black"><UserPlus size={17} />入部申請（{applicants.length}件）</h3>
      <div className="mt-3 grid gap-2">{applicants.map((m) => <div key={m.id} className="rounded-xl bg-white p-3">
        <div className="flex flex-wrap items-center gap-2"><div className="min-w-40 flex-1"><strong>{m.name}</strong><p className="text-xs text-[#68746d]">{m.contact_email || "メール不明"}・{m.role || "肩書なし"}・申請 {date(m.created_at)}</p></div>
          <button className="btn-primary" disabled={busy} onClick={() => run({ action: "approve_member", memberId: m.id })}><Check size={17} />承認</button>
          <button className="btn-secondary" disabled={busy} onClick={() => setPending({ id: m.id, kind: "reject", reason: "", days: 30 })}>承認しない</button></div>
        {pending?.id === m.id && pending.kind === "reject" && <ReasonForm pending={pending} setPending={setPending} busy={busy} label="承認しない理由（任意）" confirmLabel="承認しない" onConfirm={() => run({ action: "reject_member", memberId: m.id, reason: pending.reason })} />}
      </div>)}</div>
    </div>}

    {libraryRequests.length > 0 && <div className="mt-4 rounded-2xl border border-[#cfe0d5] bg-[#f1faf4] p-4">
      <h3 className="flex items-center gap-2 text-sm font-black"><BookUser size={17} />名刺ライブラリの閲覧申請（{libraryRequests.length}件）</h3>
      <div className="mt-3 grid gap-2">{libraryRequests.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3">
        <div className="min-w-40 flex-1"><strong>{byId.get(r.member_id)?.name ?? "部員"}</strong><p className="text-xs text-[#68746d]">理由：{r.reason}・{date(r.created_at)}</p></div>
        <button className="btn-primary" disabled={busy} onClick={() => run({ action: "decide_library_access", requestId: r.id, approve: true })}><Check size={17} />許可</button>
        <button className="btn-secondary" disabled={busy} onClick={() => run({ action: "decide_library_access", requestId: r.id, approve: false })}><X size={17} />見送り</button>
      </div>)}</div>
    </div>}

    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
      <thead className="border-b text-xs text-[#748078]"><tr><th className="p-2">氏名・連絡先</th><th className="p-2">役職</th><th className="p-2">状態</th><th className="p-2">入部日</th><th className="p-2">名刺の詳細</th><th className="p-2">操作</th></tr></thead>
      <tbody>{roster.map((m) => <tr key={m.id} className="border-b align-top last:border-0">
        <td className="p-2"><strong>{m.name}</strong>{m.id === me.id && <span className="ml-1 text-xs text-[#68746d]">（自分）</span>}<p className="text-xs text-[#68746d]">{m.contact_email || "—"}</p>{m.role && <p className="text-xs text-[#68746d]">{m.role}</p>}</td>
        <td className="p-2">{owner && m.access_role !== "owner" && m.id !== me.id && (m.status === "active" || m.status === "on_leave")
          ? <select className="field w-auto py-1 text-sm" value={m.position} disabled={busy} onChange={(e) => run({ action: "change_position", memberId: m.id, position: e.target.value })}>{assignablePositions.map((p) => <option key={p} value={p}>{positionLabel[p]}</option>)}</select>
          : positionLabel[m.position]}</td>
        <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusTone[m.status]}`}>{statusLabel[m.status]}</span>
          {m.status === "suspended" && <p className="mt-1 text-xs text-[#a93830]">{date(m.suspended_until)}まで</p>}
          {m.status === "withdrawn" && <p className="mt-1 text-xs text-[#68746d]">退部 {date(m.left_at)}</p>}
          {m.status_reason && m.status !== "active" && <p className="mt-1 text-xs text-[#68746d]">理由：{m.status_reason}</p>}</td>
        <td className="p-2 text-xs">{date(m.joined_at)}</td>
        <td className="p-2 text-xs">{m.access_role !== "member" ? "幹部（全件）" : m.status === "withdrawn" ? "—" : <label className="flex items-center gap-1 font-bold"><input type="checkbox" checked={m.library_access} disabled={busy} onChange={(e) => run({ action: "set_library_access", memberId: m.id, granted: e.target.checked })} /><KeyRound size={13} />{m.library_access ? "閲覧可" : "名前・所属のみ"}</label>}</td>
        <td className="p-2">{canActOn(m) && m.status !== "withdrawn" && <div className="flex flex-wrap gap-1">
          {m.status === "active" && <button className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => setPending({ id: m.id, kind: "leave", reason: "", days: 30 })}>休部</button>}
          {(m.status === "on_leave" || m.status === "suspended") && <button className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => run({ action: "set_member_status", memberId: m.id, status: "active", reason: "" })}>{m.status === "on_leave" ? "復部" : "停止解除"}</button>}
          {canSuspend && m.status !== "suspended" && <button className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => setPending({ id: m.id, kind: "suspend", reason: "", days: 30 })}>活動停止</button>}
          <button className="btn-danger px-2 py-1 text-xs" disabled={busy} onClick={() => setPending({ id: m.id, kind: "withdraw", reason: "", days: 30 })}>退部</button>
          {owner && m.access_role === "admin" && m.status === "active" && <button className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => run({ action: "transfer_owner", memberId: m.id })}>代表を引き継ぐ</button>}
        </div>}
          {pending?.id === m.id && pending.kind === "leave" && <ReasonForm pending={pending} setPending={setPending} busy={busy} label="メモ（任意）" confirmLabel="休部にする" onConfirm={() => run({ action: "set_member_status", memberId: m.id, status: "on_leave", reason: pending.reason })} note="休部中も部員の資格・総会の議決権は残ります（第10条）。" />}
          {pending?.id === m.id && pending.kind === "suspend" && <ReasonForm pending={pending} setPending={setPending} busy={busy} label="本人に通知する理由（必須）" confirmLabel="活動停止にする" requireReason withDays onConfirm={() => run({ action: "set_member_status", memberId: m.id, status: "suspended", reason: pending.reason, suspendedUntil: new Date(Date.now() + pending.days * 86400000).toISOString() })} note="一時制限は30日以内。7日以内に幹部会へ報告し、継続には幹部会の承認が必要です（第35条）。期限が来ると自動で解除されます。" />}
          {pending?.id === m.id && pending.kind === "withdraw" && <ReasonForm pending={pending} setPending={setPending} busy={busy} label="メモ（任意）" confirmLabel="退部にする" danger onConfirm={() => run({ action: "set_member_status", memberId: m.id, status: "withdrawn", reason: pending.reason })} note="Google連携・登録端末・名刺の閲覧権限を解除します。登録した名刺や送信履歴は部に残ります（第11条）。" />}
        </td>
      </tr>)}</tbody>
    </table></div>
    <button className="mt-3 text-xs font-bold text-[#176b45] underline" onClick={() => setShowWithdrawn(!showWithdrawn)}>{showWithdrawn ? "退部者を隠す" : "退部者も表示"}</button>
  </section>;
}

function ReasonForm({ pending, setPending, busy, label, confirmLabel, onConfirm, note, requireReason, withDays, danger }: {
  pending: Pending; setPending: (value: Pending | null) => void; busy: boolean; label: string; confirmLabel: string; onConfirm: () => void;
  note?: string; requireReason?: boolean; withDays?: boolean; danger?: boolean;
}) {
  return <div className="mt-2 grid gap-2 rounded-xl border p-3">
    <label className="label text-xs">{label}<input className="field" value={pending.reason} onChange={(e) => setPending({ ...pending, reason: e.target.value })} /></label>
    {withDays && <label className="label text-xs">停止期間（日）<input className="field w-24" type="number" min={1} max={30} value={pending.days} onChange={(e) => setPending({ ...pending, days: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} /></label>}
    {note && <p className="text-xs text-[#68746d]">{note}</p>}
    <div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={() => setPending(null)}>やめる</button><button className={danger ? "btn-danger" : "btn-primary"} disabled={busy || (requireReason && !pending.reason.trim())} onClick={onConfirm}>{confirmLabel}</button></div>
  </div>;
}
