import { Suspense } from "react";
import { CaptureWizard } from "@/components/capture-wizard";

export default function CapturePage() {
  return <Suspense fallback={<div className="card p-8 text-center">撮影画面を準備しています…</div>}><CaptureWizard /></Suspense>;
}
