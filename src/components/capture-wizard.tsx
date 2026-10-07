"use client";
/* eslint-disable @next/next/no-img-element -- local blob previews are not optimizer resources */

import { ChangeEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Camera, Check, ChevronRight, FilePenLine, LoaderCircle, Mail, Pencil, Save, ScanSearch, ShieldCheck, UserRoundCheck, X, Zap } from "lucide-react";
import { Classification, ContactInput, contactSchema, quickContactSchema, DuplicateCandidate, MergeMode, renderTemplate } from "@/lib/domain";
import { EmailCandidate, tesseractProvider } from "@/lib/ocr";
import { cropImageRegion, NormalizedRect, preprocessBusinessCardImage, rotateImage } from "@/lib/image-processing";
import { createClient } from "@/lib/supabase/browser";
import { appFetch, sha256Hex } from "@/lib/client-api";
import { createClientId } from "@/lib/client-crypto";
import { useAppData } from "@/lib/use-app-data";
import { EmailRegionSelector } from "@/components/email-region-selector";
import { enforcedCc, type AccessRole, type MailSettings, type SenderStatus } from "@/lib/organization-mail";

type Step = "capture" | "verify" | "duplicate" | "mail" | "done";
const blank: ContactInput = { name: "", company: "", role: "", email: "", phone: "", address: "", website: "", notes: "" };
const meta: Record<"important" | "courtesy", { label: string; tone: string }> = {
  important: { label: "重要", tone: "bg-[#fff1d1] text-[#805813]" },
  courtesy: { label: "礼儀", tone: "bg-[#e2f2e8] text-[#176b45]" },
};

export function CaptureWizard(props: { captureMode?: "quick" | "important" | "courtesy"; onRestart?: () => void } = {}) {
  const params = useSearchParams();
  // 撮影タブで選んだモードがあればそれを優先し、URLのモード指定は使わない。
  const quickMode = props.captureMode ? props.captureMode === "quick" : params.get("mode") === "quick";
  const param = props.captureMode || params.get("classification");
  const classification: Exclude<Classification, "no_contact"> = quickMode ? "undecided" : (param === "important" ? "important" : "courtesy");
  const debugOcr = process.env.NODE_ENV !== "production" || (process.env.NEXT_PUBLIC_ENABLE_OCR_DEBUG === "true" && params.get("debug") === "ocr");
  const [step, setStep] = useState<Step>("capture");
  const [contact, setContact] = useState<ContactInput>(blank);
  const [emailCandidates, setEmailCandidates] = useState<EmailCandidate[]>([]);
  const [rawText, setRawText] = useState("");
  const [image, setImage] = useState<string>();
  const [ocrImage, setOcrImage] = useState<Blob>();
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [manualEmail, setManualEmail] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number>();
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [contactId, setContactId] = useState("");
  const [sendKey] = useState(createClientId);
  const [sending,setSending]=useState(false);
  const [ccInput,setCcInput]=useState("");
  const [bccInput,setBccInput]=useState("");
  const [disableOrganizationCc,setDisableOrganizationCc]=useState(false);
  const [saving,setSaving]=useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  // How to handle a card for someone already in the library: merge into an existing contact, or register as a different person.
  const [mergeChoice, setMergeChoice] = useState<{targetContactId:string;mode:MergeMode}|"new"|null>(null);
  const context = useAppData<{member:{signature:string};currentEvent:{id:string;name:string}|null}>("/api/app?view=dashboard");
  const settings = useAppData<{member:{access_role:AccessRole;signature:string};sender:SenderStatus;senderChoices:{organization_email:SenderStatus;personal_email:SenderStatus}|null;mailSettings:MailSettings;organizationGoogle:{google_email:string;status:string}|null;userGoogle:{google_email:string;status:string}|null;templates:Array<{id:string;name:string;default_subject:string;default_body:string;is_default:boolean}>}>("/api/app?view=settings");

  useEffect(() => {
    if (quickMode) return; // no draft restore in quick mode
    const saved = localStorage.getItem("connection-book-capture-draft");
    if (saved) { try { const draft = JSON.parse(saved); setTimeout(() => setContact(draft), 0); } catch { /* invalid local draft */ } }
  }, [quickMode]);
  useEffect(() => { if (step !== "done" && !quickMode) localStorage.setItem("connection-book-capture-draft", JSON.stringify(contact)); }, [contact, step, quickMode]);

  const strongDuplicate = duplicates.find((item) => item.strength === "strong");
  // The server decides the sender (same logic as /api/gmail/send), so this screen can never disagree with what actually happens on send.
  const [senderChoice,setSenderChoice]=useState<"organization_email"|"personal_email">("organization_email");
  const senderChoices=settings.data?.senderChoices??null;
  const sender=senderChoices?senderChoices[senderChoice]:settings.data?.sender;
  const senderView:SenderView=settings.loading&&!settings.data?{label:"確認中…",ready:false,notice:null}:settings.error?{label:"確認できません",ready:false,notice:`送信元の接続状態を読み込めませんでした（${settings.error}）。通信を確認して再読み込みしてください。`}:!sender?{label:"確認できません",ready:false,notice:"送信元の接続状態を取得できませんでした。再読み込みしてください。"}:senderNotice(sender);
  useEffect(()=>{ if(step==="mail") void settings.reload(); /* pick up a Google connection made in another tab */ },[step]); // eslint-disable-line react-hooks/exhaustive-deps
  const requestedCc=emailsFromInput(ccInput),requestedBcc=emailsFromInput(bccInput);
  const finalCc=settings.data?enforcedCc({role:settings.data.member.access_role,settings:settings.data.mailSettings,organizationEmail:settings.data.organizationGoogle?.google_email??null,requestedCc,disableOrganizationCc}):requestedCc;

  function updatePreview(blob: Blob) {
    setImage((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
  }

  async function runOcr(blob: Blob) {
    setOcrProgress(0);
    const result = await tesseractProvider.recognize(blob, ({ progress }) => setOcrProgress(Math.round(progress * 100)));
    setRawText(result.rawText);
    setEmailCandidates(result.emailCandidates);
    setManualEmail(false);
    setContact((current) => ({ ...current, ...result.fields, email: "" }));
    if (quickMode) {
      // In quick mode, auto-select first email candidate if available
      if (result.emailCandidates.length > 0) {
        setContact((current) => ({ ...current, email: result.emailCandidates[0].value }));
      }
      setError("");
    } else {
      setError(result.emailCandidates.length === 0 ? "メールアドレスを読み取れませんでした。範囲を指定して再読取するか、手入力してください。" : "");
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) { setError("画像を1枚、10MB以下で選択してください。"); return; }
    setError("");
    setOcrProgress(0);
    try {
      const prepared = await preprocessBusinessCardImage(file);
      setOcrImage(prepared); updatePreview(prepared);
      await runOcr(prepared); setStep("verify");
    } catch (cause) {
      console.error("Business card OCR failed", cause);
      const diagnostic = process.env.NODE_ENV !== "production" ? `（開発用詳細: ${cause instanceof Error ? cause.message : String(cause)}）` : "";
      setError(`OCRを完了できませんでした。画像を撮り直すか、手入力してください。${diagnostic}`);
      setManualEmail(true); setStep("verify");
    }
    finally { setOcrProgress(undefined); }
  }

  async function reOcrRegion(region: NormalizedRect) {
    if (!ocrImage) return;
    setError(""); setOcrProgress(0);
    try {
      const cropped = await cropImageRegion(ocrImage, region);
      const result = await tesseractProvider.recognize(cropped, ({ progress }) => setOcrProgress(Math.round(progress * 100)));
      setRawText((current) => `${current}\n\n--- EMAIL REGION OCR ---\n${result.rawText}`.trim());
      setEmailCandidates(result.emailCandidates); setContact((current) => ({ ...current, email: "" }));
      setManualEmail(result.emailCandidates.length === 0); setSelectingRegion(false);
      setError(result.emailCandidates.length === 0 ? "指定範囲からもメールアドレスを読み取れませんでした。手入力してください。" : "");
    } catch { setError("指定範囲を再読取できませんでした。手入力してください。"); setManualEmail(true); }
    finally { setOcrProgress(undefined); }
  }

  async function rotate(degrees: 90 | -90) {
    if (!ocrImage) return;
    setOcrProgress(0);
    try { const rotated = await rotateImage(ocrImage, degrees); setOcrImage(rotated); updatePreview(rotated); }
    catch { setError("画像を回転できませんでした。"); }
    finally { setOcrProgress(undefined); }
  }

  function chooseManualEmail() {
    setManualEmail(true); setContact({ ...contact, email: "" });
    setTimeout(() => document.getElementById("manual-email")?.focus(), 0);
  }

  async function verify() {
    const schema = quickMode ? quickContactSchema : contactSchema;
    const parsed = schema.safeParse(contact);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "入力内容を確認してください"); return; }
    setError("");

    setMergeChoice(null);
    try { const result=await appFetch<{duplicates:DuplicateCandidate[]}>("/api/contacts/duplicates",{method:"POST",body:JSON.stringify({name:contact.name,company:contact.company,email:contact.email,phone:contact.phone})});setDuplicates(result.duplicates);
      // Quick mode stays quick when there is nothing to decide.
      if (quickMode && !result.duplicates.some(x=>x.contactId)) { await quickSave(); return; }
      setStep("duplicate"); }
    catch(cause){setError(cause instanceof Error?cause.message:"部全体の重複履歴を照合できませんでした。");}
  }

  async function quickSave() {
    if (saving) return;
    setSaving(true);
    try {
      const id = await persistContact();
      setContactId(id);
      localStorage.removeItem("connection-book-capture-draft");
      setStep("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存できませんでした。");
    } finally { setSaving(false); }
  }

  async function persistContact() {
    if(!ocrImage)throw new Error("名刺画像がありません。撮影からやり直してください。");
    const form=new FormData();const file=new File([ocrImage],`business-card-${Date.now()}.jpg`,{type:ocrImage.type||"image/jpeg"});
    form.set("image",file);form.set("metadata",JSON.stringify({contact,classification,eventId:context.data?.currentEvent?.id??null,rawText,ocrCorrected:emailCandidates.some(x=>x.source==="corrected"),imageSha256:await sha256Hex(ocrImage),quickMode,merge:mergeChoice&&mergeChoice!=="new"?mergeChoice:null}));
    const result=await appFetch<{contactId:string;statuses:{drive:string;people:string}}>("/api/contacts/register",{method:"POST",body:form});
    if(result.statuses.drive==="failed"||result.statuses.people==="failed")setError("CRM登録は完了しましたが、一部のGoogle連携に失敗しました。人物詳細で状態を確認してください。");
    return result.contactId;
  }

  async function continueAfterDuplicate() {
    if(saving)return;
    if (duplicates.some(x=>x.contactId) && !mergeChoice) { setError("既に登録されている名刺の扱い（上書き・併記・別人として登録）を選んでください。"); return; }
    if (quickMode) { await quickSave(); return; }
    if (strongDuplicate && classification==="courtesy" && !overrideReason) return;
    if((classification==="important"||classification==="courtesy")&&!settings.data?.templates.some(x=>x.is_default)){setError("デフォルトのメールテンプレートが未設定です。設定画面で作成してから登録してください。");return}
    setSaving(true);
    try {
      const id = contactId || await persistContact(); setContactId(id);
      if (classification === "important" && id) {
        const supabase = createClient(); const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("ログインし直してください。");
        const template=settings.data?.templates.find(x=>x.is_default);if(!template)throw new Error("CRM登録は完了しましたが、デフォルトのメールテンプレートが未設定のためGmail下書きを作成できません。");const draftBody = renderTemplate(template.default_body, { recipient_name: contact.name, sender_signature: context.data?.member.signature??"" });
        const response = await fetch("/api/gmail/draft", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ contactId: id, recipientEmail: contact.email, subject: template.default_subject, body: draftBody }) });
        if (!response.ok) throw new Error("CRMへ登録しましたが、Gmail下書きを作成できませんでした。");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "CRMへ登録できませんでした。");setSaving(false); return; }
    if (classification === "courtesy") {
      const template=settings.data?.templates.find(x=>x.is_default);if(!template){setError("CRM登録は完了しましたが、デフォルトのメールテンプレートが未設定です。設定画面で作成してください。");setSaving(false);return}setSubject(template.default_subject);setBody(renderTemplate(template.default_body, { recipient_name: contact.name, sender_signature: context.data?.member.signature??"" }));
      setStep("mail");
    } else setStep("done");setSaving(false);
  }

  async function send() {
    if(sending)return;
    if (!navigator.onLine) { setError("オフラインでは送信できません。通信を確認してください。"); return; }
    if (!contactId) { setError("送信前のCRM登録が完了していません。"); return; }
    setSending(true);try {
      const supabase = createClient(); const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("ログインし直してください。");
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
      const confirmation = await fetch("/api/gmail/confirmation", { method: "POST", headers, body: JSON.stringify({ contactId, recipientEmail: contact.email }) });
      if (!confirmation.ok) {const payload=await confirmation.json().catch(()=>({}));throw new Error(payload.error==="contact_state_changed"?"確認後に宛先または分類が変更されました。名刺情報へ戻って再確認してください。":confirmation.status===401?"セッション期限が切れました。再ログインしてください。":"宛先の再確認に失敗しました。名刺情報へ戻って確認してください。");}
      const { token } = await confirmation.json();
      const template=settings.data?.templates.find(x=>x.is_default);const result = await fetch("/api/gmail/send", { method: "POST", headers, body: JSON.stringify({ contactId, recipientEmail: contact.email, cc:requestedCc, bcc:requestedBcc, disableOrganizationCc, subject, body, templateId: template?.id??null, eventId: context.data?.currentEvent?.id??null, classification: "courtesy", confirmedRecipient: true, confirmationToken: token, idempotencyKey: sendKey, duplicateOverride: Boolean(strongDuplicate), duplicateOverrideReason: strongDuplicate ? overrideReason : null, ...(senderChoices?{senderModeOverride:senderChoice}:{}) }) });
      if (!result.ok) {const payload=await result.json().catch(()=>({}));const messages:Record<string,string>={recipient_confirmation_expired:"宛先確認の有効期限が切れました。もう一度確認してください。",contact_state_changed:"確認後に宛先または分類が変更されたため送信を拒否しました。",duplicate_submission:"同じ送信操作は既に処理されています。送信履歴を確認してください。",organization_google_not_connected:"組織Googleアカウントが未接続です。設定画面で接続してください。",user_google_not_connected:"個人Googleアカウントが未接続です。設定画面で接続してください。",organization_google_reauth_required:"組織Googleアカウントの接続が切れています。管理者が設定画面で「再接続」してください。（まだ送信されていません）",user_google_reauth_required:"個人Googleアカウントの接続が切れています。設定画面で「再接続」してください。（まだ送信されていません）",send_failed:"Gmail送信に失敗しました。送信済み履歴を確認してから再操作してください。"};if(String(payload.error).endsWith("_google_reauth_required")||String(payload.error).endsWith("_google_not_connected"))void settings.reload();throw new Error(messages[payload.error]??payload.message??"送信できませんでした。履歴を確認してから再操作してください。");}
      localStorage.removeItem("connection-book-capture-draft"); setStep("done");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "送信できませんでした。"); }finally{setSending(false)}
  }

  return <div className="mx-auto max-w-3xl">
    <Header classification={classification} quickMode={quickMode}/>
    {quickMode ? <QuickSteps step={step}/> : <Steps step={step}/>}
    {step === "capture" && <CaptureStep progress={ocrProgress} error={error} onFile={onFile} quickMode={quickMode}/>}
    {step === "verify" && (quickMode
      ? <QuickVerifyStep
          contact={contact} setContact={setContact} image={image} rawText={rawText} debugOcr={debugOcr}
          candidates={emailCandidates} progress={ocrProgress} error={error} saving={saving}
          ocrImage={ocrImage} onSelectRegion={() => setSelectingRegion(true)} onCancelRegion={() => setSelectingRegion(false)}
          selectingRegion={selectingRegion} onReadRegion={reOcrRegion} onRotate={rotate}
          onBack={() => setStep("capture")} onSave={verify}
        />
      : <VerifyStep
          contact={contact} setContact={setContact} image={image} rawText={rawText} debugOcr={debugOcr}
          candidates={emailCandidates} manualEmail={manualEmail} selectingRegion={selectingRegion}
          ocrImage={ocrImage} progress={ocrProgress} error={error}
          onManual={chooseManualEmail} onSelectRegion={() => setSelectingRegion(true)} onCancelRegion={() => setSelectingRegion(false)}
          onReadRegion={reOcrRegion} onRotate={rotate} onBack={() => setStep("capture")} onVerify={verify}
        />
    )}
    {step === "duplicate" && <DuplicateStep contact={contact} duplicates={duplicates} mergeChoice={mergeChoice} setMergeChoice={(value)=>{setMergeChoice(value);setError("")}} askReason={Boolean(strongDuplicate)&&classification==="courtesy"&&!quickMode} reason={overrideReason} saving={saving} error={error} setReason={setOverrideReason} onBack={() => setStep("verify")} onContinue={continueAfterDuplicate}/>}
    {step === "mail" && <MailStep contact={contact} sender={senderView} senderChoices={senderChoices?{value:senderChoice,onChange:setSenderChoice,organization:senderChoices.organization_email.email,personal:senderChoices.personal_email.email}:null} onRetrySender={()=>void settings.reload()} ccInput={ccInput} setCcInput={setCcInput} finalCc={finalCc} bccInput={bccInput} setBccInput={setBccInput} templateName={settings.data?.templates.find(x=>x.is_default)?.name??"未設定"} signature={settings.data?.member.signature??context.data?.member.signature??""} canDisableOrganizationCc={Boolean(settings.data?.member.access_role==="member"&&settings.data.mailSettings.auto_cc_organization_email&&settings.data.mailSettings.allow_member_to_disable_cc)} disableOrganizationCc={disableOrganizationCc} setDisableOrganizationCc={setDisableOrganizationCc} subject={subject} setSubject={setSubject} body={body} setBody={setBody} confirmed={confirmed} setConfirmed={setConfirmed} error={error} sending={sending} onBack={() => setStep("verify")} onSend={send}/>}
    {step === "done" && <DoneStep classification={classification} contactId={contactId} quickMode={quickMode} onRestart={props.onRestart}/>}
  </div>;
}

function Header({ classification, quickMode }: { classification: Exclude<Classification, "no_contact">; quickMode: boolean }) {
  if (quickMode) return <div className="mb-6 flex items-center justify-between"><div><p className="eyebrow">Quick capture</p><h1 className="text-2xl font-black">クイック撮影</h1></div><span className="rounded-full bg-[#e0e7ff] px-3 py-1.5 text-sm font-black text-[#4338ca]"><Zap size={14} className="mr-1 inline"/>速記録</span></div>;
  return <div className="mb-6 flex items-center justify-between"><div><p className="eyebrow">Business card intake</p><h1 className="text-2xl font-black">名刺を1枚登録</h1></div><span className={`rounded-full px-3 py-1.5 text-sm font-black ${meta[classification as "important"|"courtesy"]?.tone ?? "bg-[#ececf4] text-[#5d6279]"}`}>{meta[classification as "important"|"courtesy"]?.label ?? "未処理"}</span></div>;
}

function QuickSteps({ step }: { step: Step }) { const current = ["capture", "verify", "done"].indexOf(step === "duplicate" ? "verify" : step === "mail" ? "done" : step); return <ol className="mb-6 grid grid-cols-3 gap-2 text-center text-[11px] font-bold text-[#7c867f]">{["1 撮影", "2 確認", "3 完了"].map((label, index) => <li key={label} className={`border-b-4 pb-2 ${current >= index ? "border-[#4338ca] text-[#4338ca]" : "border-[#dce4de]"}`}>{label}</li>)}</ol>; }
function Steps({ step }: { step: Step }) { const current = ["capture", "verify", "duplicate", "mail", "done"].indexOf(step); return <ol className="mb-6 grid grid-cols-4 gap-2 text-center text-[11px] font-bold text-[#7c867f]">{["1 撮影", "2 内容確認", "3 重複確認", "4 処理確定"].map((label, index) => <li key={label} className={`border-b-4 pb-2 ${current >= index ? "border-[#176b45] text-[#176b45]" : "border-[#dce4de]"}`}>{label}</li>)}</ol>; }

function CaptureStep({ progress, error, onFile, quickMode }: { progress?: number; error: string; onFile: (event: ChangeEvent<HTMLInputElement>) => void; quickMode: boolean }) {
  return <section className="card overflow-hidden p-5 md:p-8"><div className="rounded-[18px] border-2 border-dashed border-[#b9c9bf] bg-[#f4f8f5] p-8 text-center"><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white text-[#176b45] shadow-sm">{quickMode ? <Zap size={30}/> : <Camera size={30}/>}</span><h2 className="mt-4 text-xl font-black">{quickMode ? "パシャっと撮るだけ" : "名刺を1枚だけ撮影"}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#69756d]">{quickMode ? "名刺全体を撮影してください。分類やメール送信は後から処理できます。" : "名刺全体が入るように撮影してください。結果は必ず次の画面で確認します。"}</p><div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row"><label className="btn-primary w-full sm:w-auto"><Camera size={19}/>カメラを起動<input className="sr-only" type="file" accept="image/*" capture="environment" multiple={false} onChange={onFile}/></label><label className="btn-secondary w-full sm:w-auto"><ScanSearch size={19}/>写真から選ぶ<input className="sr-only" type="file" accept="image/*" multiple={false} onChange={onFile}/></label></div>{progress !== undefined && <Progress value={progress}/>}</div>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="mt-4 flex gap-3 rounded-xl bg-[#fff5dd] p-3 text-xs leading-5 text-[#795514]"><ShieldCheck className="mt-0.5 shrink-0" size={18}/><p>{quickMode ? <><strong>あとから処理できます。</strong><br/>分類・メール送信は人物詳細から行えます。</> : <><strong>一括処理はできません。</strong><br/>1回につき、名刺1枚・人物1人・送信先1件です。</>}</p></div></section>;
}

type QuickVerifyProps = { contact: ContactInput; setContact: (value: ContactInput) => void; image?: string; rawText: string; debugOcr: boolean; candidates: EmailCandidate[]; progress?: number; error: string; saving: boolean; ocrImage?: Blob; selectingRegion: boolean; onSelectRegion: () => void; onCancelRegion: () => void; onReadRegion: (region: NormalizedRect) => void; onRotate: (degrees: 90 | -90) => void; onBack: () => void; onSave: () => void };
function QuickVerifyStep(props: QuickVerifyProps) {
  const { contact, setContact } = props;
  return <section className="card p-5 md:p-7"><div className="mb-5 flex items-start gap-3"><Zap className="mt-1 text-[#4338ca]"/><div><h2 className="text-xl font-black">読み取り結果を確認</h2><p className="mt-1 text-sm text-[#6f7973]">氏名だけ合っていればOK。詳細は後から編集できます。</p></div></div>
    {props.image && <img src={props.image} alt="撮影した名刺" className="mb-5 max-h-48 w-full rounded-xl border bg-[#eef2ef] object-contain"/>}
    {props.debugOcr && <details className="mb-5 rounded-xl border border-[#9ca9a1] bg-[#17211b] text-[#e6f4eb]" open><summary className="cursor-pointer px-4 py-3 text-xs font-black tracking-[.12em]">OCR RAW TEXT · DEBUG ONLY</summary><pre className="max-h-64 overflow-auto border-t border-white/15 p-4 text-xs leading-6 whitespace-pre-wrap">{props.rawText || "（OCR生テキストなし）"}</pre></details>}
    {props.selectingRegion && props.image && <EmailRegionSelector imageUrl={props.image} busy={props.progress !== undefined} onCancel={props.onCancelRegion} onRead={props.onReadRegion} onRotate={props.onRotate}/>}
    {props.progress !== undefined && <Progress value={props.progress}/>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Field label="氏名 *" value={contact.name} onChange={(name) => setContact({...contact, name})}/>
      <Field label="会社・所属" value={contact.company} onChange={(company) => setContact({...contact, company})}/>
      <Field label="役職" value={contact.role} onChange={(role) => setContact({...contact, role})}/>
      <label className="label">メールアドレス（あれば）
        {props.candidates.length > 0 ? <>
          <select className="field" value="" onChange={(event) => { if (event.target.value) setContact({...contact, email: event.target.value}); }}>
            <option value="">OCR候補から選択</option>
            {props.candidates.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.value}{candidate.source === "corrected" ? "（補正）" : ""}</option>)}
          </select>
          <input className="field mt-1" inputMode="email" placeholder="手入力も可" value={contact.email} onChange={(event) => setContact({...contact, email: event.target.value})}/>
        </> : <>
          <input className="field" inputMode="email" placeholder="後からでもOK" value={contact.email} onChange={(event) => setContact({...contact, email: event.target.value})}/>
          <div className="mt-1 flex gap-2">
            <button className="btn-secondary text-xs" onClick={props.onSelectRegion} disabled={!props.ocrImage}><ScanSearch size={15}/>範囲を再読取</button>
          </div>
        </>}
      </label>
      <Field label="電話番号" value={contact.phone} onChange={(phone) => setContact({...contact, phone})}/>
    </div>
    {props.error && <ErrorMessage>{props.error}</ErrorMessage>}
    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
      <button onClick={props.onBack} className="btn-secondary"><ArrowLeft size={18}/>撮り直す</button>
      <button onClick={props.onSave} className="btn-primary" disabled={!contact.name.trim() || props.saving}>{props.saving ? <><LoaderCircle size={18} className="animate-spin"/>保存中…</> : <>保存する<Check size={18}/></>}</button>
    </div>
  </section>;
}

type VerifyProps = { contact: ContactInput; setContact: (value: ContactInput) => void; image?: string; rawText: string; debugOcr: boolean; candidates: EmailCandidate[]; manualEmail: boolean; selectingRegion: boolean; ocrImage?: Blob; progress?: number; error: string; onManual: () => void; onSelectRegion: () => void; onCancelRegion: () => void; onReadRegion: (region: NormalizedRect) => void; onRotate: (degrees: 90 | -90) => void; onBack: () => void; onVerify: () => void };
function VerifyStep(props: VerifyProps) {
  const { contact, setContact } = props;
  return <section className="card p-5 md:p-7"><div className="mb-5 flex items-start gap-3"><FilePenLine className="mt-1 text-[#176b45]"/><div><h2 className="text-xl font-black">OCR結果を確認・修正</h2><p className="mt-1 text-sm text-[#6f7973]">OCR・補正候補は入力補助です。名刺原本と照合してください。</p></div></div>
    {props.image && <img src={props.image} alt="撮影した名刺" className="mb-5 max-h-48 w-full rounded-xl border bg-[#eef2ef] object-contain"/>}
    {props.debugOcr && <details className="mb-5 rounded-xl border border-[#9ca9a1] bg-[#17211b] text-[#e6f4eb]" open><summary className="cursor-pointer px-4 py-3 text-xs font-black tracking-[.12em]">OCR RAW TEXT · DEBUG ONLY</summary><pre className="max-h-64 overflow-auto border-t border-white/15 p-4 text-xs leading-6 whitespace-pre-wrap">{props.rawText || "（OCR生テキストなし）"}</pre></details>}
    {props.candidates.length === 0 && <div role="alert" className="mb-4 rounded-2xl border-2 border-[#e0a044] bg-[#fff6df] p-4"><div className="flex gap-3"><AlertTriangle className="shrink-0 text-[#a25c00]"/><div><strong>メールアドレスを読み取れませんでした</strong><p className="mt-1 text-xs leading-5 text-[#72561f]">空のまま次へは進めません。メール部分を再読取するか、名刺を見て手入力してください。</p></div></div><div className="mt-3 grid grid-cols-2 gap-2"><button className="btn-secondary text-xs" onClick={props.onSelectRegion} disabled={!props.ocrImage}><ScanSearch size={17}/>画像から再読取</button><button className="btn-secondary text-xs" onClick={props.onManual}><Pencil size={17}/>手入力</button></div></div>}
    {props.selectingRegion && props.image && <EmailRegionSelector imageUrl={props.image} busy={props.progress !== undefined} onCancel={props.onCancelRegion} onRead={props.onReadRegion} onRotate={props.onRotate}/>}
    {props.progress !== undefined && <Progress value={props.progress}/>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="氏名 *" value={contact.name} onChange={(name) => setContact({...contact, name})}/><Field label="会社・所属" value={contact.company} onChange={(company) => setContact({...contact, company})}/><Field label="役職" value={contact.role} onChange={(role) => setContact({...contact, role})}/>
      <label className="label"><span className="text-[#a8332b]">送信先メールアドレス *</span>{!props.manualEmail && props.candidates.length > 0 ? <><select aria-label="メールアドレス候補から入力" className="field border-2 border-[#cf5a50]" value="" onChange={(event) => { if (event.target.value) setContact({...contact, email: event.target.value}); }}><option value="">候補から入力・選び直す</option>{props.candidates.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.value}{candidate.source === "corrected" ? "（補正候補）" : ""}</option>)}</select><span className="mt-1 text-xs font-bold text-[#176b45]">選択後に下の欄で直接修正できます</span><input className="field border-2 border-[#cf5a50]" inputMode="email" autoComplete="email" spellCheck={false} placeholder="候補を選ぶか、名刺を見て入力" value={contact.email} onChange={(event) => setContact({...contact, email: event.target.value})}/>{props.candidates.some((candidate) => candidate.source === "corrected") && <small className="rounded-lg bg-[#fff3d6] p-2 font-medium text-[#805813]">補正候補を含みます。句読点等を名刺原本で必ず確認してください。</small>}</> : <input id="manual-email" className="field border-2 border-[#cf5a50]" inputMode="email" autoComplete="email" spellCheck={false} placeholder="名刺を見ながら入力" value={contact.email} onChange={(event) => setContact({...contact, email: event.target.value})}/>}<small className="font-medium text-[#a8332b]">候補は自動確定されません。必ず人間が選択・修正します。</small></label>
      <Field label="電話番号" value={contact.phone} onChange={(phone) => setContact({...contact, phone})}/><Field label="Webサイト" value={contact.website} onChange={(website) => setContact({...contact, website})}/><label className="label sm:col-span-2">住所<input className="field" value={contact.address} onChange={(event) => setContact({...contact, address:event.target.value})}/></label><label className="label sm:col-span-2">その他情報・メモ<textarea className="field min-h-24" value={contact.notes} onChange={(event) => setContact({...contact, notes:event.target.value})}/></label></div>
    {props.error && <ErrorMessage>{props.error}</ErrorMessage>}<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button onClick={props.onBack} className="btn-secondary"><ArrowLeft size={18}/>撮り直す</button><button onClick={props.onVerify} className="btn-primary" disabled={!contact.email.trim()}>内容を確認した<ChevronRight size={18}/></button></div>
  </section>;
}

const fieldLabels:Array<[keyof ContactInput & keyof NonNullable<DuplicateCandidate["existing"]>,string]>=[["name","氏名"],["company","会社・団体"],["role","役職"],["email","メール"],["phone","電話"],["address","住所"],["website","Web"]];
const reasonLabel:Record<DuplicateCandidate["reason"],string>={email:"メールアドレスが一致",phone:"電話番号が一致",name_company:"氏名と所属が一致"};
type DuplicateProps={contact:ContactInput;duplicates:DuplicateCandidate[];mergeChoice:{targetContactId:string;mode:MergeMode}|"new"|null;setMergeChoice:(value:{targetContactId:string;mode:MergeMode}|"new")=>void;askReason:boolean;reason:string;saving:boolean;error:string;setReason:(value:string)=>void;onBack:()=>void;onContinue:()=>void};
function DuplicateStep(props:DuplicateProps){
  const candidates=props.duplicates.filter(x=>x.contactId&&x.existing);
  const choice=props.mergeChoice;
  const isChosen=(id:string,mode:MergeMode)=>choice!==null&&choice!=="new"&&choice.targetContactId===id&&choice.mode===mode;
  const option=(checked:boolean,onChange:()=>void,title:string,detail:string,disabled=false)=><label className={`flex items-start gap-3 rounded-xl border-2 p-3 ${disabled?"cursor-not-allowed opacity-60":"cursor-pointer"} ${checked?"border-[#176b45] bg-[#eef7f1]":"border-[#dce4de] bg-white"}`}><input type="radio" className="mt-1 size-4 accent-[#176b45]" checked={checked} disabled={disabled} onChange={onChange}/><span><strong className="block text-sm">{title}</strong><span className="text-xs text-[#5f6b64]">{detail}</span></span></label>;
  return <section className="card p-5 md:p-7"><h2 className="text-xl font-black">部全体の履歴を確認</h2>
  {candidates.length?<div className="mt-4 grid gap-4">
    <div className="flex gap-3 rounded-2xl border-2 border-[#dc9b35] bg-[#fff6df] p-4"><AlertTriangle className="shrink-0 text-[#a25c00]"/><div><strong>この人はすでに名刺ライブラリに登録されている可能性があります</strong><p className="mt-1 text-sm">同じ人を二重に登録しないよう、どう保存するか選んでください。</p></div></div>
    {candidates.map(candidate=>{const existing=candidate.existing!,id=candidate.contactId!;return <div key={id} className="rounded-2xl border p-4">
      <p className="text-sm"><strong>{existing.name}</strong>（{existing.company||"所属なし"}）<span className="ml-2 rounded-full bg-[#f3f6f4] px-2 py-0.5 text-xs font-bold">{reasonLabel[candidate.reason]}</span></p>
      {candidate.sentAt&&<p className="mt-1 text-xs text-[#6d7871]">{candidate.senderName?`${candidate.senderName}さんが`:""}{new Intl.DateTimeFormat("ja-JP").format(new Date(candidate.sentAt))}にお礼メールを送信済み{candidate.eventName&&`（${candidate.eventName}）`}</p>}
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead className="text-[#748078]"><tr><th className="p-1.5">項目</th><th className="p-1.5">登録済み</th><th className="p-1.5">今回の名刺</th></tr></thead><tbody>{fieldLabels.filter(([key])=>!candidate.detailsHidden||key==="name"||key==="company").map(([key,label])=>{const before=existing[key]??"",after=props.contact[key]??"";const changed=Boolean(after.trim())&&after.trim()!==before.trim();return <tr key={key} className="border-t"><td className="p-1.5 font-bold">{label}</td><td className="p-1.5 break-all">{before||"—"}</td><td className={`p-1.5 break-all ${changed?"font-bold text-[#a25c00]":""}`}>{after||"—"}</td></tr>})}</tbody></table></div>
      {candidate.detailsHidden&&<p className="mt-2 text-xs text-[#6d7871]">ほかの部員が登録した名刺のため、連絡先は表示されません。</p>}
      <div className="mt-3 grid gap-2">
        {option(isChosen(id,"overwrite"),()=>props.setMergeChoice({targetContactId:id,mode:"overwrite"}),"上書き保存",candidate.canOverwrite===false?"上書きできるのは、この名刺を登録した人と管理者だけです。":"今回の名刺の内容で更新します（空欄の項目は登録済みの値を残します）。",candidate.canOverwrite===false)}
        {option(isChosen(id,"append"),()=>props.setMergeChoice({targetContactId:id,mode:"append"}),"併記して保存","登録済みの内容はそのままに、違う部分を「別の名刺の情報」としてメモに残します。")}
      </div></div>})}
    {option(choice==="new",()=>props.setMergeChoice("new"),"別人として新規登録","同姓同名など、登録済みの人とは別人の場合に選びます。")}
  </div>:<div className="mt-4 flex gap-3 rounded-2xl bg-[#e8f6ed] p-5 text-[#176b45]"><UserRoundCheck/><div><strong>重複候補は見つかりませんでした</strong><p className="mt-1 text-sm">部全体の履歴を照合しました。</p></div></div>}
  {props.askReason&&<label className="label mt-5">同じメールアドレスへ再度お礼メールを送る理由<select className="field" value={props.reason} onChange={(event)=>props.setReason(event.target.value)}><option value="">理由を選択</option><option>再会した</option><option>別イベント</option><option>担当交代</option><option>再送依頼</option><option>その他</option></select></label>}
  {props.error&&<ErrorMessage>{props.error}</ErrorMessage>}
  <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button className="btn-secondary" disabled={props.saving} onClick={props.onBack}><ArrowLeft size={18}/>名刺情報に戻る</button><div className="flex gap-2"><Link href="/" className="btn-danger"><X size={18}/>登録をやめる</Link><button className="btn-primary" disabled={props.saving||(candidates.length>0&&!choice)||(props.askReason&&!props.reason)} onClick={props.onContinue}>{props.saving?"保存・連携中…":<>保存して次へ<ChevronRight size={18}/></>}</button></div></div></section>;
}

type SenderChoiceProps={value:"organization_email"|"personal_email";onChange:(value:"organization_email"|"personal_email")=>void;organization:string|null;personal:string|null};
type MailProps = { contact: ContactInput;sender:SenderView;senderChoices:SenderChoiceProps|null;onRetrySender:()=>void;ccInput:string;setCcInput:(value:string)=>void;finalCc:string[];bccInput:string;setBccInput:(value:string)=>void;templateName:string;signature:string;canDisableOrganizationCc:boolean;disableOrganizationCc:boolean;setDisableOrganizationCc:(value:boolean)=>void;subject: string; setSubject: (value:string)=>void; body:string; setBody:(value:string)=>void; confirmed:boolean; setConfirmed:(value:boolean)=>void; error:string;sending:boolean; onBack:()=>void; onSend:()=>void };
function MailStep(props: MailProps) { return <section className="card p-5 md:p-7"><div className="flex items-start gap-3"><Mail className="mt-1 text-[#176b45]"/><div><h2 className="text-xl font-black">お礼メールを編集・最終確認</h2><p className="mt-1 text-sm text-[#6d7871]">From・To・CC・BCCを含め、送信内容を確認してください。</p></div></div>{props.senderChoices&&<fieldset className="mt-5 grid gap-2"><legend className="text-sm font-black">送信元を選ぶ</legend><div className="grid gap-2 sm:grid-cols-2">{([["organization_email","組織代表メール",props.senderChoices.organization],["personal_email","自分のメール",props.senderChoices.personal]] as const).map(([value,label,email])=><label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-sm ${props.senderChoices!.value===value?"border-[#176b45] bg-[#f1faf4]":"border-[#e2e2e2]"}`}><input className="mt-1 accent-[#176b45]" type="radio" name="sender-choice" checked={props.senderChoices!.value===value} disabled={props.sending} onChange={()=>{props.senderChoices!.onChange(value);props.setConfirmed(false)}}/><span><span className="block font-bold">{label}</span><span className="block break-all text-xs text-[#6d7871]">{email??"未接続"}</span></span></label>)}</div></fieldset>}<div className="my-5 grid gap-2 rounded-2xl border-2 border-[#cf5a50] bg-[#fff4f2] p-5 text-sm"><p><strong>From：</strong><span className={`break-all ${props.sender.ready?"":"font-bold text-[#a93830]"}`}>{props.sender.label}</span></p><p><strong>To：</strong><span className="break-all text-[#9f2f28]">{props.contact.email}</span></p><p><strong>CC：</strong><span className="break-all">{props.finalCc.join(", ")||"なし"}</span></p><p><strong>BCC：</strong><span className="break-all">{emailsFromInput(props.bccInput).join(", ")||"なし"}</span></p><p><strong>テンプレート：</strong>{props.templateName}</p><p className="whitespace-pre-wrap"><strong>署名：</strong>{props.signature||"未設定"}</p></div>{props.sender.notice&&<div role="alert" className="mb-5 grid gap-3 rounded-xl border border-[#cf5a50] bg-white p-4 text-sm"><p className="font-bold text-[#a93830]">{props.sender.notice}</p><div className="flex flex-wrap gap-2">{props.sender.settingsLink&&<Link href="/settings" className="btn-secondary">設定画面を開く</Link>}<button type="button" className="btn-secondary" onClick={props.onRetrySender}>接続状態を再確認</button></div></div>}<div className="grid gap-4"><label className="label">CC（複数はカンマ区切り）<input className="field" value={props.ccInput} onChange={(event)=>props.setCcInput(event.target.value)}/></label>{props.canDisableOrganizationCc&&<label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={props.disableOrganizationCc} onChange={(event)=>props.setDisableOrganizationCc(event.target.checked)}/>組織代表メールの自動CCを外す</label>}<label className="label">BCC（複数はカンマ区切り）<input className="field" value={props.bccInput} onChange={(event)=>props.setBccInput(event.target.value)}/></label><label className="label">件名<input className="field" value={props.subject} onChange={(event)=>props.setSubject(event.target.value)}/></label><label className="label">本文<textarea className="field min-h-64 leading-7" value={props.body} onChange={(event)=>props.setBody(event.target.value)}/></label><label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4"><input className="mt-1 size-5 accent-[#176b45]" type="checkbox" checked={props.confirmed} onChange={(event)=>props.setConfirmed(event.target.checked)}/><span className="text-sm font-bold">名刺原本と照らし合わせ、From・To・CC・BCCと送信本文を確認しました</span></label></div>{props.error&&<ErrorMessage>{props.error}</ErrorMessage>}<div className="mt-6 grid gap-3 sm:grid-cols-3"><button className="btn-secondary" disabled={props.sending} onClick={props.onBack}>名刺を修正</button><Link href="/" className="btn-danger">送信しない</Link><button className="btn-primary" disabled={props.sending||!props.confirmed||!props.sender.ready||!props.subject.trim()||!props.body.trim()} onClick={props.onSend}><Mail size={18}/>{props.sending?"Gmail送信中…":"確認した内容で送信"}</button></div></section>; }

function emailsFromInput(value:string){return [...new Set(value.split(/[;,\n]/).map(item=>item.trim().toLowerCase()).filter(Boolean))]}

function DoneStep({ classification, contactId, quickMode, onRestart }: { classification: Exclude<Classification,"no_contact">; contactId:string; quickMode: boolean; onRestart?: () => void }) {
  return <section className="card p-8 text-center">
    <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#e2f2e8] text-[#176b45]"><Check size={30}/></span>
    <h2 className="mt-4 text-2xl font-black">{quickMode ? "記録しました" : "処理を完了しました"}</h2>
    <p className="mt-2 text-sm text-[#69756d]">{quickMode
      ? "名刺を記録しました。分類やメール送信は人物詳細からいつでも行えます。"
      : classification === "important" ? "要手動対応として記録し、下書きを作成しました。自動送信はしていません。"
      : "人間が確認した最終内容を送信履歴へ保存しました。"
    }</p>
    <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
      {contactId&&<Link href={`/contacts/${contactId}`} className="btn-secondary"><Save size={18}/>人物詳細</Link>}
      {onRestart
        ? <button type="button" className="btn-primary" onClick={onRestart}><Camera size={18}/>続けて撮影</button>
        : quickMode && <Link href="/capture?mode=quick" className="btn-primary"><Camera size={18}/>続けて撮影</Link>}
      <Link href="/" className="btn-secondary">ホーム</Link>
    </div>
  </section>;
}

function Field({ label, value, onChange }: { label:string; value:string; onChange:(value:string)=>void }) { return <label className="label">{label}<input className="field" value={value} onChange={(event)=>onChange(event.target.value)}/></label>; }
function Progress({ value }: { value:number }) { return <div className="mt-4"><LoaderCircle className="mx-auto animate-spin text-[#176b45]"/><p className="mt-1 text-center text-xs font-bold">OCR処理中 {value}%</p></div>; }
function ErrorMessage({ children }: { children:React.ReactNode }) { return <div role="alert" className="mt-4 flex gap-2 rounded-xl bg-[#fff0ee] p-3 text-sm font-bold text-[#a93830]"><AlertTriangle className="shrink-0" size={18}/>{children}</div>; }

type SenderView={label:string;ready:boolean;notice:string|null;settingsLink?:boolean};
function senderNotice(sender:SenderStatus):SenderView{
  const account=sender.mode==="organization_email"?"組織Googleアカウント":"個人Googleアカウント";
  const who=sender.fixableBy==="manager"?"オーナーか管理者に、設定画面で":"設定画面で";
  if(sender.state==="ready")return{label:sender.email??"",ready:true,notice:null};
  if(sender.state==="needs_reconnect")return{label:`${sender.email}（要再接続）`,ready:false,settingsLink:true,notice:`${account}（${sender.email}）の接続が切れています。Google側で権限が取り消されたか、パスワードが変更された可能性があります。${who}「再接続」してください。`};
  return{label:"未接続",ready:false,settingsLink:true,notice:`あなたのメールは${account}から送信する設定ですが、まだ接続されていません。${who}${account}を接続してください。`};
}
