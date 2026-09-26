import { AlertTriangle, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "読み込み中…" }: { label?: string }) { return <div className="card mt-6 flex items-center justify-center gap-2 p-8 text-sm font-bold text-[#68746d]"><LoaderCircle className="animate-spin" size={19}/>{label}</div>; }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div role="alert" className="card mt-6 flex items-center gap-3 border-[#dfaaa5] p-5 text-sm font-bold text-[#a93830]"><AlertTriangle className="shrink-0"/><span className="flex-1">{message}</span>{retry&&<button className="btn-secondary" onClick={retry}>再試行</button>}</div>; }
export function EmptyState({ children }: { children: React.ReactNode }) { return <div className="card mt-6 p-8 text-center text-sm font-bold text-[#68746d]">{children}</div>; }
