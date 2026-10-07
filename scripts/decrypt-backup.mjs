// つながり帳のバックアップ（.tsbk）を元のJSONに戻す。
// 使い方（PowerShell）:
//   $env:BACKUP_ENCRYPTION_KEY="控えておいた鍵"; node scripts/decrypt-backup.mjs tsunagari-backup-20261008-0300.tsbk > backup.json
import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";

const [file] = process.argv.slice(2);
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");
if (!file || key.length !== 32) {
  console.error("使い方: BACKUP_ENCRYPTION_KEY を設定して node scripts/decrypt-backup.mjs <ファイル.tsbk>");
  process.exit(1);
}
const data = readFileSync(file);
if (data.subarray(0, 5).toString() !== "TSBK1") { console.error("つながり帳のバックアップファイルではありません。"); process.exit(1); }
const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(5, 17));
decipher.setAuthTag(data.subarray(17, 33));
process.stdout.write(gunzipSync(Buffer.concat([decipher.update(data.subarray(33)), decipher.final()])).toString("utf8"));
