"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { appFetch } from "@/lib/client-api";

/** 名刺ライブラリの詳細（連絡先など）を見るための申請。幹部が設定画面で許可する。 */
export function LibraryAccessRequest({ pending, onRequested }: { pending: boolean; onRequested?: () => void }) {
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [open, setOpen] = useState(false);
  async function submit() {
    setBusy(true); setMessage("");
    try { await appFetch("/api/app", { method: "POST", body: JSON.stringify({ action: "request_library_access", reason }) }); setMessage("申請しました。幹部が許可すると連絡先まで見られるようになります。"); setOpen(false); onRequested?.(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "申請できませんでした。"); }
    finally { setBusy(false); }
  }
  return <div className="rounded-2xl border border-[#cfe0d5] bg-[#f1faf4] p-4 text-sm">
    <p className="flex items-center gap-2 font-bold text-[#176b45]"><KeyRound size={17} />ほかの部員が登録した名刺は、人物名と所属だけ表示しています。</p>
    <p className="mt-1 text-xs text-[#5f6b64]">連絡先などの詳細は、幹部と、幹部に閲覧を許可された部員だけが見られます。自分で登録した名刺はすべて見られます。</p>
    {pending ? <p className="mt-3 text-xs font-bold text-[#a25c00]">閲覧を申請中です。幹部の確認をお待ちください。</p>
      : open ? <div className="mt-3 grid gap-2"><label className="label text-xs">使いたい理由（幹部に表示されます）<textarea className="field min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：〇〇社の方に事業の相談をしたい" /></label><div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>やめる</button><button className="btn-primary" disabled={busy || !reason.trim()} onClick={submit}>申請する</button></div></div>
      : <button className="btn-secondary mt-3" onClick={() => setOpen(true)}>詳細の閲覧を申請する</button>}
    {message && <p role="status" className="mt-2 text-xs font-bold">{message}</p>}
  </div>;
}
