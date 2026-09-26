import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "つながり帳", template: "%s | つながり帳" },
  description: "起業部内限定の名刺管理・お礼メール支援PWA",
  applicationName: "つながり帳",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "つながり帳" },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ja"
      className="h-full antialiased"
    >
      <body className="min-h-full"><ServiceWorkerRegistration /><AppShell>{children}</AppShell></body>
    </html>
  );
}
