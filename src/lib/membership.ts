/**
 * 規約（広島大学起業部 1st Penguin Club 規約, 2026-10 改定）に基づく部員・役職・閲覧権限のルール。
 * Pure functions so the same rules drive the API, the UI and the tests.
 */
export type Position = "representative" | "vice_representative" | "treasurer" | "executive" | "member";
export type MemberStatus = "pending" | "active" | "on_leave" | "suspended" | "withdrawn";
export type Viewer = { id: string; access_role: string; position?: string | null; library_access?: boolean | null };

export const positionLabel: Record<Position, string> = {
  representative: "代表", vice_representative: "副代表", treasurer: "会計", executive: "幹部", member: "部員",
};
export const statusLabel: Record<MemberStatus, string> = {
  pending: "承認待ち", active: "在籍", on_leave: "休部中", suspended: "活動停止中", withdrawn: "退部",
};
export const assignablePositions: Position[] = ["vice_representative", "treasurer", "executive", "member"];

export const isOfficer = (viewer: Pick<Viewer, "access_role">) => viewer.access_role === "owner" || viewer.access_role === "admin";

/** 第35条: アクセスの一時制限は代表と副代表。第36条の活動停止は幹部会決議を代表・副代表が記録する。 */
export const canSuspend = (viewer: Viewer) => viewer.access_role === "owner" || viewer.position === "vice_representative";

/** An officer may act on members; only the 代表 may act on other officers. Nobody acts on themself or on the 代表. */
export function canActOnMember(viewer: Viewer, target: { id: string; access_role: string }) {
  if (viewer.id === target.id || target.access_role === "owner") return false;
  if (viewer.access_role === "owner") return true;
  return viewer.access_role === "admin" && target.access_role === "member";
}

/** 人脈情報の詳細（連絡先・メモ・履歴）を見られるか。幹部、承認された部員、その名刺を登録した本人。 */
export function canViewContactDetails(viewer: Viewer, contact: { created_by?: string | null }) {
  return isOfficer(viewer) || Boolean(viewer.library_access) || (Boolean(contact.created_by) && contact.created_by === viewer.id);
}

const limitedFields = ["id", "name", "company_name", "university_name", "organization_name"] as const;
export type LimitedContact = { id: string; name: string; company_name: string; university_name: string; organization_name: string; restricted: true };

/** 権限のない部員に見せるのは人物名と所属だけ。 */
export function limitContact(row: Record<string, unknown>): LimitedContact {
  const out: Record<string, unknown> = { restricted: true };
  for (const key of limitedFields) out[key] = row[key] ?? "";
  return out as LimitedContact;
}

/** Search text a viewer may match against: restricted rows only expose name and affiliation. */
export function searchableText(row: Record<string, unknown>, full: boolean) {
  const source = full ? row : limitContact(row);
  return JSON.stringify(source).toLocaleLowerCase("ja-JP");
}

export type MembershipGate = { ok: true } | { ok: false; error: string; message: string };

/** Who may use the app: 在籍・休部中 yes; 承認待ち・活動停止中・退部 no (with a reason the person can act on). */
export function membershipGate(member: { status: string; suspended_until?: string | null }, now = new Date()): MembershipGate {
  switch (member.status) {
    case "active": case "on_leave": return { ok: true };
    case "pending": return { ok: false, error: "membership_pending", message: "入部の承認待ちです。代表または幹部が承認すると使えるようになります。" };
    case "suspended": {
      const until = member.suspended_until ? new Date(member.suspended_until) : null;
      if (until && until <= now) return { ok: true };
      const date = until ? `${new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeZone: "Asia/Tokyo" }).format(until)}まで` : "";
      return { ok: false, error: "membership_suspended", message: `現在、利用が一時停止されています${date ? `（${date}）` : ""}。代表または副代表に確認してください。` };
    }
    default: return { ok: false, error: "membership_withdrawn", message: "退部済みのアカウントです。再入部する場合は招待コードから申請してください。" };
  }
}
