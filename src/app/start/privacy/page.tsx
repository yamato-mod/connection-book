import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "プライバシーポリシー | つながり帳" };

const sections: { title: string; body: string[] }[] = [
  {
    title: "1. このアプリについて",
    body: [
      "つながり帳は、広島大学起業部 1st Penguin Club の部員が、名刺・人脈・イベント・お知らせを共有するための部内向けWebアプリです。一般公開のサービスではなく、招待された部員だけが使います。",
    ],
  },
  {
    title: "2. 集める情報",
    body: [
      "部員の情報：メールアドレス、氏名、役職、ログイン記録。",
      "部員が登録する情報：名刺に書かれた氏名・会社・役職・連絡先、メモ、タグ、フォローアップ予定、イベント・ビジコン・バイト・お知らせの内容。",
      "名刺の文字読み取り（OCR）は利用者の端末の中で行い、画像を外部のAIサービスへ送ることはありません。",
    ],
  },
  {
    title: "3. Googleアカウントのデータの使い方",
    body: [
      "部の組織Googleアカウントを1つだけ接続し、次の目的にのみ使います。",
      "Gmail（gmail.compose）：ログインリンク、確認コード、お礼メールの送信と下書き作成。受信メールを読むことはしません。",
      "Googleカレンダー（calendar.events.owned）：フォローアップ予定と部のイベントを、組織アカウントのカレンダーに登録・表示します。",
      "Googleドライブ（drive.file）：名刺画像と暗号化バックアップを保存します。このアプリが作ったファイル以外にはアクセスしません。",
      "Googleから受け取ったデータは上記の機能を動かすためだけに使い、広告に使ったり、第三者に販売・提供したりしません。人がデータを閲覧するのは、利用者の同意がある場合、セキュリティ上必要な場合、または法令で求められた場合に限ります。",
      "本アプリによるGoogle APIから受け取った情報の利用と他アプリへの移転は、Limited Use の要件を含む Google API Services User Data Policy に従います。",
    ],
  },
  {
    title: "4. 保存場所と保護",
    body: [
      "データは Supabase（東京リージョン）のデータベースに保存し、アプリは Vercel（東京リージョン）で動いています。",
      "Googleの接続情報（リフレッシュトークン）は AES-256-GCM で暗号化して保存します。バックアップファイルも暗号化します。",
      "部員は自分の部のデータだけを見られ、連絡先の詳細は権限に応じて表示を制限します。",
    ],
  },
  {
    title: "5. 保存期間と削除",
    body: [
      "データは部の活動に必要な間保存します。バックアップは最新30回分を残し、それより古いものは削除します。",
      "退部した部員のアカウントは無効化します。自分のデータの削除や、Google接続の解除を希望する場合は下記の窓口へ連絡してください。Googleアカウントの「サードパーティ製のアプリとサービス」からいつでも接続を解除できます。",
    ],
  },
  {
    title: "6. 問い合わせ窓口",
    body: ["広島大学起業部 1st Penguin Club つながり帳 管理者：kazutoshi9981@gmail.com"],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-[#1d2b22]">
      <h1 className="text-2xl font-black">プライバシーポリシー</h1>
      <p className="mt-2 text-sm text-[#5b6b60]">制定日：2026年10月8日</p>
      <div className="mt-6 grid gap-6">
        {sections.map((section) => (
          <section key={section.title} className="grid gap-2">
            <h2 className="text-lg font-bold">{section.title}</h2>
            {section.body.map((line) => (
              <p key={line} className="text-sm leading-7">{line}</p>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-8 text-sm">
        <Link href="/start" className="font-bold text-[#176b45] underline">つながり帳に戻る</Link>
      </p>
    </main>
  );
}
