# つながり帳

1st Penguin Club 内部向けの、名刺管理・お礼メール支援PWAです。

> 判断は人間、処理はシステム。

相手の分類は利用者が必ず先に「重要 / 礼儀 / 判断迷う」から選択します。AI、OCR、スコア、ルールは分類に使いません。「礼儀」でも自動送信せず、テンプレートを編集できる画面、宛先の再確認、利用者による最後の送信操作を必須にしています。

## 実装済みの縦断フロー

- モバイル優先ホームと3分類の入口
- カメラ入力（1枚のみ）とTesseract.js OCR抽象化
- OCR生テキストの開発用表示、Unicode／全角／空白／改行の正規化
- 通常Regexと、0件時だけ動くOCR誤認識補正候補の二段階抽出
- メール部分のドラッグ範囲指定、拡大・再OCR、手動90度回転
- OCR結果の手動修正、複数メール候補からの手動選択
- 部全体の実データを使うメール・電話・氏名＋所属の重複警告
- 礼儀メールの件名・本文編集、宛先強調、最終確認チェック
- 重要／判断迷うの非送信フロー
- Supabase実データによる人物CRM、人物編集、タグ、メモ、イベント、フォローアップ、端末設定
- PWA manifest、Service Worker、standalone表示
- Supabaseスキーマ、最小権限GRANT、RLS、外部キー索引
- Gmail送信／下書き、Drive画像、People連絡先、Calendar予定のサーバー専用API境界
- 5分有効の宛先確認トークンと送信冪等性キー
- 最終送信内容、重複上書き理由、監査ログの保存設計

ホーム、人物一覧・詳細、イベント、フォローアップ、設定、テンプレートはすべてSupabaseの実データを参照します。環境変数が未設定の場合にサンプル値へフォールバックせず、設定エラーを表示します。Google資格情報が未設定の状態では、Gmail・Drive・People・Calendar処理は成功扱いになりません。

## 必要環境

- Node.js 22以上
- npm 10以上
- Supabase CLI 2.117以上（`npx supabase`でも可）
- Docker Desktop（ローカルSupabaseを起動する場合）

## ローカル起動

```bash
npm install
copy .env.local.example .env.local
npm run dev
```

`http://localhost:3000/settings` を開き、Supabase Authのマジックリンクでログインします。ログイン後、端末はランダムIDのSHA-256ハッシュで自動登録されます。

開発環境では確認画面に`OCR RAW TEXT · DEBUG ONLY`が表示されます。本番で一時的に必要な場合だけ`NEXT_PUBLIC_ENABLE_OCR_DEBUG=true`を設定し、`/capture?debug=ocr`を使用してください。通常は必ず`false`に戻してください。メール候補は1件でも自動選択されず、人間が選択または手入力するまで次へ進めません。

### OCRだけをすぐ試す

1. `http://localhost:3000/capture?classification=courtesy` を開きます。
2. 「カメラを起動」から実物の名刺、または `public/ocr-test-card.png` を選びます。
3. `OCR RAW TEXT · DEBUG ONLY` にOCR全文が表示されることを確認します。
4. メール候補が未選択のまま表示され、「内容を確認した」が無効であることを確認します。
5. 名刺原本と照合して候補を1件選ぶと、初めて「内容を確認した」が有効になります。

TesseractのWorker、WASM、日本語・英語学習データは`public/tesseract/`から同一オリジン配信します。実行時に外部CDNへ接続しないため、企業ネットワークやインストール済みPWAでもOCR起動が外部Worker制限に依存しません。

## Supabase設定

1. Supabaseで新規Projectを作成します。
2. Project URL、Publishable key、Secret keyを `.env.local` に設定します。
3. Authentication > URL ConfigurationでSite URLとVercel URLを登録します。
4. Email OTPを有効化します。内部メンバー以外は招待しないでください。
5. migration適用後、Authentication > Usersで最初の部員を招待します。作成されたAuth user IDを確認し、SQL Editorで次を実行します（値は実環境に置換）。

```sql
with new_club as (
  insert into public.clubs (name, email_domain)
  values ('1st Penguin Club', 'example.jp')
  returning id
)
insert into public.members (
  club_id, auth_user_id, name, role, signature_display_name, signature, is_admin
)
select id, 'AUTH_USER_UUID', '管理者氏名', '役職', '管理者氏名',
       E'1st Penguin Club\n役職 管理者氏名', true
from new_club;
```

6. 設定画面でデフォルトのメールテンプレートを1件作成します。本文では `{{recipient_name}}` と `{{sender_signature}}` を利用できます。
7. Data API設定で必要テーブルを明示公開します。migrationは`anon`権限を付与せず、`authenticated`にも必要な操作だけをGRANTします。

### migration実行

ローカルDB:

```bash
npx supabase start
npx supabase db reset
npx supabase migration list --local
```

リンク済みの開発Project:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

本番へ直接試行錯誤でSQLを流さず、ローカルで検証済みのmigrationだけを適用してください。

## Google Cloud Console設定

組織Google接続と個人Google接続は別レコードです。refresh tokenは
`GOOGLE_TOKEN_ENCRYPTION_KEY`によるAES-256-GCM暗号文だけをSupabaseへ保存し、
ブラウザには返しません。OAuth stateは署名・期限・HttpOnly nonceで検証します。

このアプリが要求するGmail scopeは
`https://www.googleapis.com/auth/gmail.compose`です。既存の重要人物向け下書き作成と
明示的な送信の両方を維持するためのscopeであり、受信箱・送信済み一覧・既存スレッドを
読み取るscopeは要求しません。

Supabaseの`email_logs`に保存するのは、このアプリの送信ボタンから開始された
`pending / sent / failed`の試行だけです。Gmailの`messages.list`や`threads.list`、
CC先メールボックスの監視・同期は実装していません。

1. Google Cloud Consoleで専用Projectを作成します。
2. APIs & Servicesで Gmail API / Google Drive API / People API / Google Calendar API を有効化します。
3. OAuth consent screenを内部用またはテスト用に設定します。
4. OAuth 2.0 Client ID（Web application）を作り、Redirect URIをローカルとVercelに登録します。
5. Client ID / Client secretはVercelのServer環境変数だけへ保存します。
6. `GOOGLE_TOKEN_ENCRYPTION_KEY`に32ランダムバイトのbase64、
   `GOOGLE_OAUTH_STATE_SECRET`に32文字以上のランダム値を設定します。
7. Authorized redirect URIへ`<APP_URL>/api/google/oauth/callback`を完全一致で登録します。

### Gmail API

必要スコープは可能な限り絞り、送信と下書きには `https://www.googleapis.com/auth/gmail.compose` を利用します。メールはサーバーでRFC 2822 MIMEを組み立て、base64url化して`users.messages.send`または`users.drafts.create`を呼びます。Refresh tokenをブラウザへ返してはいけません。

### Drive API

名刺画像は `1st Penguin Club CRM/名刺/YYYY/MM/` に実体1つだけ保存し、ファイルIDを`google_files`と`business_cards`へ記録します。イベント／タグごとの複製は禁止し、分類はDBで管理します。推奨スコープは `drive.file` です。

### People API

作成前にメールアドレスで既存Contactを検索します。一致時は重複作成せず、利用者確認後に既存Contactを更新します。推奨スコープは `contacts` です。

### Calendar API

「Google Calendarに追加」ボタンを押したときだけ予定を作成します。バックグラウンド一括登録はしません。推奨スコープは `calendar.events` です。

### 部活共通Gmailの初回認証

1. ownerまたはadminが設定画面の「組織Googleアカウント」で「Googleと接続」を押します。
2. 部活共通Googleアカウントでログインし、表示されたscopeを承認します。
3. callbackがstateとHttpOnly nonceを検証し、暗号化したrefresh tokenをorganizationへ保存します。
4. ownerが交代しても、この接続はorganization資産として維持されます。

各部員は「個人Googleアカウント」から本人だけが接続・再接続・解除できます。
他メンバーの個人接続を操作するAPIはありません。

## 新しい団体を作る

公開URLの `/start` から、利用者は次のどちらかを選択します。

- `部員としてログイン`: 幹部から招待済みのメールアドレスだけでログインします。未知のメールアドレスからAuthユーザーを自動作成しません。
- `新しい団体を作る`: メール認証後、団体名・団体種別・owner氏名・役職を入力して団体を開設します。

団体作成は `create_organization_for_user` RPC内の単一トランザクションで、組織、owner、組織メールポリシー、標準メールテンプレート、監査ログを同時に作ります。同一Authユーザーによる重複作成は拒否されます。RPCは `service_role` だけが実行でき、ブラウザから直接呼び出せません。

## 認証と初回端末登録

Supabase Email OTPでログインした後、`members.auth_user_id`が有効な部員と一致する場合だけ利用できます。初回アクセス時、ブラウザで`crypto.randomUUID()`を生成してlocalStorageに保存し、SHA-256ハッシュだけを`devices`へ保存します。IMEI等は取得しません。設定画面から役職・署名変更、端末解除、ログアウトによる利用者変更ができます。

## PWAインストール

- iPhone: Safariの共有メニュー > ホーム画面に追加
- Android: Chromeメニュー > アプリをインストール
- HTTPSのVercel環境でService Workerが有効になります。

撮影途中の入力はlocalStorageへ退避します。Service WorkerはGET画面のみキャッシュし、`/api/*`はキャッシュもオフラインキューも行いません。オフライン時のメール送信は禁止です。

## Vercelデプロイ

1. GitHub等へpushし、VercelでImportします。
2. Framework PresetはNext.js、Node.jsは22以上を選択します。
3. `.env.local.example`の全値をEnvironment Variablesへ登録します。
4. `NEXT_PUBLIC_APP_URL`を本番`.vercel.app` URLへ変更します。
5. Google OAuthのAuthorized redirect URIとSupabase Auth URLへ本番URLを追加します。
6. Preview環境ではGoogle送信資格情報を原則設定しないでください。

## 本番運用

- イベント開始時に「現在のイベント」を1件だけ選択します。
- 1回につき名刺1枚・人物1人・宛先1件・最大1通を守ります。
- 共有GmailのSentと`email_logs`を定期照合します。
- 退任者はまずSupabase Authのセッションを無効化し、その後`members.is_active=false`、端末revoke、担当引継ぎを行います。
- Google OAuth tokenとSecret keyを定期ローテーションします。
- DBバックアップと監査ログを定期確認します。

## 検証

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Supabaseを起動できる環境では、さらに`npx supabase db reset`、`npx supabase test db`、`npx supabase db advisors`を実行してください。Gmailの実送信テストは専用テスト宛先1件でのみ行い、二重クリック、期限切れ確認token、分類変更、メール変更、重複理由なし、オフラインをそれぞれ拒否することを確認します。

## トラブルシューティング

- OCRが遅い: 初回はアプリ内の日本語・英語学習データ（約5MB）を読み込みます。明るく正面から撮影し、失敗時はメール部分の範囲指定または手入力を使用してください。
- HEICが読めない: 端末／ブラウザによりデコードできないことがあります。カメラ設定を互換性優先にするかJPEGで撮影してください。
- `401`: Supabase sessionがありません。Email OTPで再ログインしてください。
- `403`: `members.auth_user_id`またはOrigin設定を確認してください。
- `409 contact_state_changed`: 確認後に分類またはメールが変更されています。画面を戻って再確認してください。
- `409 duplicate_submission`: 同じ送信操作が既に処理されています。再送せず履歴を確認してください。
- Gmail `invalid_grant`: Refresh tokenの失効です。部活共通Gmailで初回認証をやり直してください。
- PWA更新が見えない: タブを閉じて再起動するか、Service Worker更新後に再読み込みしてください。

## ディレクトリ

```text
src/app/                 App Router画面・サーバーRoute Handlers
src/components/          モバイルUI・撮影ウィザード
src/lib/                 ドメイン検証、OCR、Supabase、Google境界
supabase/migrations/     再現可能なDBスキーマとRLS
tests/                   誤送信防止・重複判定のテスト
public/                  PWA icon / Service Worker / Tesseract実行資産
```
