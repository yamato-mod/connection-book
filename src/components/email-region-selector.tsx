"use client";

import { useRef, useState } from "react";
import { Crop, RotateCcw, RotateCw, ScanSearch, X } from "lucide-react";
import type { NormalizedRect } from "@/lib/image-processing";

type Point = { x: number; y: number };
const minimumRegionSize = 0.025;

export function EmailRegionSelector({ imageUrl, busy, onCancel, onRead, onRotate }: {
  imageUrl: string;
  busy: boolean;
  onCancel: () => void;
  onRead: (region: NormalizedRect) => void;
  onRotate: (degrees: 90 | -90) => void;
}) {
  const start = useRef<Point | null>(null);
  const [region, setRegion] = useState<NormalizedRect | null>(null);

  function point(event: React.PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = point(event);
    setRegion({ x: start.current.x, y: start.current.y, width: 0, height: 0 });
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const current = point(event);
    setRegion({ x: Math.min(start.current.x, current.x), y: Math.min(start.current.y, current.y), width: Math.abs(start.current.x - current.x), height: Math.abs(start.current.y - current.y) });
  }
  function onPointerUp() { start.current = null; }
  const usable = Boolean(region && region.width >= minimumRegionSize && region.height >= minimumRegionSize);

  return <div className="mt-5 rounded-2xl border-2 border-[#8ba797] bg-[#f2f7f3] p-4">
    <div className="flex items-start gap-3"><Crop className="mt-0.5 shrink-0 text-[#176b45]"/><div><h3 className="font-black">メールアドレス部分を指定</h3><p className="mt-1 text-xs leading-5 text-[#5f6c64]">画像上のメールアドレスを指で囲んでください。選んだ範囲だけを拡大・高コントラスト化して再OCRします。</p></div></div>
    <div className="mt-3 flex gap-2"><button type="button" className="btn-secondary min-h-10 flex-1 py-1 text-xs" onClick={() => onRotate(-90)} disabled={busy}><RotateCcw size={16}/>左へ90°</button><button type="button" className="btn-secondary min-h-10 flex-1 py-1 text-xs" onClick={() => onRotate(90)} disabled={busy}><RotateCw size={16}/>右へ90°</button></div>
    <div className="relative mt-3 select-none overflow-hidden rounded-xl border bg-white touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} role="img" aria-label="メールアドレス部分をドラッグして選択">
      {/* eslint-disable-next-line @next/next/no-img-element -- user-selected local blob */}
      <img src={imageUrl} alt="OCR対象の名刺" className="pointer-events-none block h-auto w-full" draggable={false}/>
      {region && <div className="pointer-events-none absolute border-2 border-[#e34b3f] bg-[#e34b3f]/15 shadow-[0_0_0_9999px_rgb(0_0_0/.28)]" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}/>} 
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}><X size={17}/>キャンセル</button><button type="button" className="btn-primary" disabled={!usable || busy} onClick={() => region && onRead(region)}>{busy ? <span className="animate-pulse">再OCR中…</span> : <><ScanSearch size={18}/>この範囲を再読取</>}</button></div>
  </div>;
}
