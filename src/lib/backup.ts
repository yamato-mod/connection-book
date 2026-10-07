import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { DRIVE_FILE_SCOPE, isGoogleConnectionScopeMissing, organizationDrive } from "@/lib/google";
import { decryptGoogleToken } from "@/lib/google-token-crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 部のデータを暗号化して、組織Googleアカウントのドライブに保存する。
 * - 対象は部のデータ（名刺・部員・イベント・掲示板など）。Googleの鍵や認証コードの記録は入れない。
 * - 暗号化は AES-256-GCM。鍵は Vercel の環境変数 BACKUP_ENCRYPTION_KEY（32バイトをbase64）。
 *   鍵がないと復元できないので、パスワード管理アプリにも控えておく。
 * - 名刺の画像はドライブ側にあるので、ここには入らない。
 */

type Db = ReturnType<typeof createAdminClient>;

/** バックアップに入れる表。club_id で部ごとに絞る（clubs だけは id）。 */
const TABLES = [
  "clubs", "members", "organization_mail_settings", "contacts", "notes", "followups", "tags", "contact_tags",
  "events", "event_contacts", "email_templates", "email_logs", "email_send_requests", "business_cards", "google_files",
  "library_access_requests", "announcements", "job_postings", "business_contests", "audit_logs",
] as const;

const MAGIC = Buffer.from("TSBK1");
const KEEP_GENERATIONS = 30;
const FOLDER_NAME = "つながり帳バックアップ";

function backupKey() {
  const encoded = process.env.BACKUP_ENCRYPTION_KEY;
  if (!encoded) throw new BackupError("key_missing", "バックアップ用の鍵（BACKUP_ENCRYPTION_KEY）が設定されていません。");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new BackupError("key_invalid", "バックアップ用の鍵の形が正しくありません（32バイトのbase64）。");
  return key;
}

export class BackupError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function encryptBackup(json: string, key = backupKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(Buffer.from(json, "utf8"))), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBackup(file: Buffer, key: Buffer) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("つながり帳のバックアップファイルではありません。");
  const iv = file.subarray(5, 17), tag = file.subarray(17, 33), body = file.subarray(33);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return gunzipSync(Buffer.concat([decipher.update(body), decipher.final()])).toString("utf8");
}

async function dumpTable(supabase: Db, table: string, clubId: string) {
  const rows: unknown[] = [];
  const column = table === "clubs" ? "id" : "club_id";
  for (let from = 0; ; from += 1000) {
    const page = await supabase.from(table).select("*").eq(column, clubId).range(from, from + 999);
    if (page.error) throw page.error;
    rows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 1000) break;
  }
  return rows;
}

/** 1つの部のバックアップを作ってドライブに保存し、結果を backup_runs に記録する。 */
export async function backupClub(supabase: Db, clubId: string, trigger: "scheduled" | "manual") {
  const startedAt = new Date();
  try {
    const connection = await supabase.from("organization_google_connections").select("google_email, encrypted_refresh_token, status, scopes").eq("club_id", clubId).maybeSingle();
    if (connection.error) throw connection.error;
    if (!connection.data || connection.data.status !== "active") throw new BackupError("google_not_connected", "組織Googleアカウントが接続されていません。");
    if (isGoogleConnectionScopeMissing(connection.data.scopes, DRIVE_FILE_SCOPE)) throw new BackupError("drive_scope_missing", "組織Googleアカウントにドライブの許可がありません。設定画面で組織Googleアカウントを「再接続」し、ドライブへのアクセスを許可してください。");

    const tables: Record<string, unknown[]> = {};
    for (const table of TABLES) tables[table] = await dumpTable(supabase, table, clubId);
    const json = JSON.stringify({ format: "tsunagari-backup", version: 1, clubId, createdAt: startedAt.toISOString(), tables });
    const encrypted = encryptBackup(json);

    const drive = organizationDrive(decryptGoogleToken(connection.data.encrypted_refresh_token));
    const folderId = await ensureFolder(drive, clubId);
    const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(startedAt).replace(/[-: ]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
    const name = `tsunagari-backup-${stamp}.tsbk`;
    const created = await drive.files.create({
      requestBody: { name, parents: [folderId], mimeType: "application/octet-stream", appProperties: { tsunagariBackupFile: clubId } },
      media: { mimeType: "application/octet-stream", body: Readable.from(encrypted) },
      fields: "id,name",
    });
    await pruneOldBackups(drive, folderId);

    const rowCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
    await supabase.from("backup_runs").insert({ club_id: clubId, trigger, status: "succeeded", file_name: name, drive_file_id: created.data.id ?? null, bytes: encrypted.length, row_count: rowCount });
    return { ok: true as const, name, bytes: encrypted.length, rowCount };
  } catch (error) {
    const message = error instanceof BackupError ? error.message : "バックアップに失敗しました。";
    console.error("Backup failed", clubId, error);
    await supabase.from("backup_runs").insert({ club_id: clubId, trigger, status: "failed", error_message: (error instanceof Error ? `${message} (${error.message})` : message).slice(0, 1000) });
    return { ok: false as const, code: error instanceof BackupError ? error.code : "failed", message };
  }
}

type Drive = ReturnType<typeof organizationDrive>;

async function ensureFolder(drive: Drive, clubId: string) {
  const found = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='tsunagariBackupFolder' and value='${clubId}' }`,
    fields: "files(id)", pageSize: 1,
  });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder", appProperties: { tsunagariBackupFolder: clubId } },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Drive folder was not created");
  return created.data.id;
}

/** 新しい順に30個だけ残し、それより古いものはゴミ箱へ（30日間は戻せる）。 */
async function pruneOldBackups(drive: Drive, folderId: string) {
  const listed = await drive.files.list({ q: `'${folderId}' in parents and trashed=false`, orderBy: "createdTime desc", fields: "files(id)", pageSize: 100 });
  const old = (listed.data.files ?? []).slice(KEEP_GENERATIONS);
  for (const file of old) if (file.id) await drive.files.update({ fileId: file.id, requestBody: { trashed: true } });
}
