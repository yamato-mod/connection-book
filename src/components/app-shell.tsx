"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Home, ScanLine, Settings, Users } from "lucide-react";

const nav = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/contacts", label: "人物", icon: Users },
  { href: "/capture", label: "撮影", icon: ScanLine },
  { href: "/events", label: "イベント", icon: CalendarDays },
  { href: "/settings", label: "設定", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if(path.startsWith("/start"))return <div className="min-h-screen bg-[#f4f7f4]"><header className="border-b border-[#dce4de] bg-white"><Link href="/start" className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4" aria-label="つながり帳 はじめる"><span className="grid size-9 place-items-center rounded-xl bg-[#176b45] text-white"><ScanLine size={20}/></span><span><span className="block text-[11px] font-bold tracking-[.12em] text-[#176b45]">ORGANIZATION CRM</span><span className="block text-lg font-black leading-5">つながり帳</span></span></Link></header>{children}</div>;
  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <header className="sticky top-0 z-30 border-b border-[#dce4de] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="つながり帳 ホーム">
            <span className="grid size-9 place-items-center rounded-xl bg-[#176b45] text-white"><ScanLine size={20} /></span>
            <span><span className="block text-[11px] font-bold tracking-[.12em] text-[#176b45]">1ST PENGUIN CLUB</span><span className="block text-lg font-black leading-5">つながり帳</span></span>
          </Link>
          <div className="hidden items-center gap-2 rounded-full bg-[#f1f5f2] px-3 py-2 text-xs font-bold text-[#536158] sm:flex"><span className="size-2 rounded-full bg-[#2f9e64]" />部内限定</div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dce4de] bg-white/97 px-2 pb-[max(.4rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_20px_rgb(24_34_28/0.06)] md:static md:mx-auto md:mt-4 md:max-w-3xl md:rounded-2xl md:border">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return <Link key={href} href={href} className={`grid min-h-14 place-items-center rounded-xl text-[11px] font-bold ${active ? "bg-[#e2f2e8] text-[#176b45]" : "text-[#68746d]"}`}><Icon size={20} strokeWidth={active ? 2.6 : 2} /><span>{label}</span></Link>;
          })}
        </div>
      </nav>
    </div>
  );
}
