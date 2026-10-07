import type { ContactInput } from "@/lib/domain";

export type OcrProgress = { status: string; progress: number };
export type EmailCandidate = {
  value: string;
  source: "strict" | "corrected";
  original: string;
  warnings: string[];
};
export type BusinessCardOcrResult = {
  rawText: string;
  normalizedText: string;
  fields: Partial<ContactInput>;
  emailCandidates: EmailCandidate[];
};
export interface OcrProvider {
  recognize(image: Blob, onProgress?: (progress: OcrProgress) => void): Promise<BusinessCardOcrResult>;
}

const strictEmailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;
const phonePattern = /(?:\+?81[-\s]?)?(?:0\d{1,4})[-\s]?\d{1,4}[-\s]?\d{3,4}/g;
const phoneLinePattern = /(?:\+?81[-\s]?)?(?:0\d{1,4})[-\s]?\d{1,4}[-\s]?\d{3,4}/;
const urlPattern = /(?:https?:\/\/|www\.)[^\s]+/gi;
const invisiblePattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const organizationPattern = /株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人|医療法人|社会福祉法人|大学|大学院|研究所|協会|財団|銀行|病院|事務所|起業部|ホールディングス|\b(?:inc\.?|ltd\.?|llc|corp\.?|corporation|company|university)\b/i;
const rolePattern = /代表取締役|事務局長|事務長|局長|所長|院長|学長|学部長|代表社員|業務執行社員|取締役|執行役員|副代表|共同代表|代表|会長|社長|副社長|専務|常務|本部長|事業部長|部長|次長|課長|室長|支店長|店長|係長|主任|顧問|理事|監事|教授|准教授|講師|マネージャー|ディレクター|プロデューサー|エンジニア|デザイナー|コンサルタント|ファウンダー|創業者|CEO|COO|CFO|CTO|CMO|CIO|リーダー|チーフ|秘書/i;
const contactLinePattern = /@|(?:https?:\/\/|www\.)|(?:^|\s)(?:tel|phone|mobile|fax|mail|e-mail|email|〒)\s*[:：]?/i;

/** Normalizes OCR typography without making ambiguous O/0, I/l, or rn/m substitutions. */
/**
 * Fixes misreads that Tesseract makes again and again on Japanese legal-entity names
 * (e.g. 一 read as the long-vowel mark ー, 学 as 字, 社 as 杜). Only applied next to entity words.
 */
function fixEntityMisreads(text: string) {
  return text
    .replace(/(^|\s)[ー－‐-]般(社団|財団)/gm, "$1一般$2")
    .replace(/字校法人/g, "学校法人")
    .replace(/(株式|有限|合同|合資|合名)会杜/g, "$1会社")
    .replace(/会杜(?=\s|$)/gm, "会社");
}

export function normalizeOcrText(text: string) {
  return fixEntityMisreads(text)
    .normalize("NFKC")
    .replace(invisiblePattern, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalizes a single extracted candidate. It never performs ambiguous glyph substitution. */
export function normalizeEmailCandidate(candidate: string) {
  return candidate
    .normalize("NFKC")
    .replace(invisiblePattern, "")
    .replace(/\s+/g, "")
    .replace(/\((?:at)\)|\[(?:at)\]/gi, "@")
    .replace(/[。]/g, ".")
    .toLowerCase()
    .replace(/^[<({\["']+|[>)}\]"';:]+$/g, "");
}

function uniqueCandidates(candidates: EmailCandidate[]) {
  return [...new Map(candidates.map((candidate) => [candidate.value, candidate])).values()];
}

/** "E-mailtaro@..." — OCR often glues the label to the address. Never strips a bare "mail@" local part. */
function stripEmailLabels(text: string) {
  return text.replace(/(^|\s)e-?mail\s*[:：]?\s*(?=[a-z0-9._%+-]+@)/gim, "$1 ");
}

/** "example.orjp" → "example.or.jp": the dot before a Japanese second-level domain is often lost. */
function fixJapaneseSecondLevelDomain(email: string) {
  return email.replace(/\.?(co|or|ac|ne|go|ed|gr|lg|ad)jp$/i, (match, sld: string) => (match.startsWith(".") || /@[^.]*$/.test(email) ? `.${sld}.jp` : match));
}

function strictCandidates(text: string): EmailCandidate[] {
  return (stripEmailLabels(text).match(strictEmailPattern) ?? []).map((original) => {
    const value = normalizeEmailCandidate(original), fixed = fixJapaneseSecondLevelDomain(value);
    return fixed === value
      ? { value, source: "strict" as const, original, warnings: [] }
      : { value: fixed, source: "corrected" as const, original, warnings: [".jp の前のドット抜けを補正"] };
  });
}

/**
 * Extracts strict addresses first. OCR-specific punctuation correction runs only
 * when strict extraction finds nothing; corrected values always remain candidates.
 */
export function extractEmailCandidates(rawText: string): EmailCandidate[] {
  const normalized = normalizeOcrText(rawText);
  const strict = uniqueCandidates(strictCandidates(normalized));
  if (strict.length > 0) return strict;

  const warnings: string[] = [];
  let corrected = normalized;
  if (/\(at\)|\[at\]/i.test(corrected)) {
    corrected = corrected.replace(/\s*(?:\(at\)|\[at\])\s*/gi, "@");
    warnings.push("(at) / [at] を @ の候補として補正");
  }
  if (/[。]/.test(corrected)) {
    corrected = corrected.replace(/。/g, ".");
    warnings.push("句点をドット候補として補正");
  }
  // A comma is only considered between email-like ASCII tokens.
  if (/[a-z0-9],[a-z0-9]/i.test(corrected)) {
    corrected = corrected.replace(/(?<=[a-z0-9]),(?=[a-z0-9])/gi, ".");
    warnings.push("カンマをドット候補として補正");
  }
  // "@greenleafjp" → "@greenleaf.jp" (only when the domain has no dot at all, so it can't be a valid address as read).
  if (/@[a-z0-9-]+(?:jp|com|net|org|io|dev)\b(?!\.)/i.test(corrected)) {
    corrected = corrected.replace(/(@[a-z0-9-]+?)(jp|com|net|org|io|dev)\b(?!\.)/gi, "$1.$2");
    warnings.push("ドメインのドット抜けを補正");
  }
  corrected = corrected
    .replace(/\s*@\s*/g, "@")
    .replace(/(?<=[a-z0-9._%+-])\s*\n\s*(?!https?:|www\.)(?=[a-z0-9.-])/gi, "")
    .replace(/\s*\.\s*/g, ".");

  return uniqueCandidates(strictCandidates(corrected).map((candidate) => ({
    ...candidate,
    source: "corrected" as const,
    original: rawText,
    warnings: warnings.length ? warnings : ["改行・空白を除去した補正候補"],
  })));
}

function cleanCardLine(line: string) {
  return line.replace(/^[|｜:：・•\-–—\s]+|[|｜:：・•\-–—\s]+$/g, "").replace(/\s{2,}/g, " ").trim();
}

function latinNameScore(line: string) {
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 4 || !words.every((word) => /^[A-Za-z][A-Za-z'.-]+$/.test(word))) return 0;
  if (organizationPattern.test(line) || rolePattern.test(line)) return 0;
  const titleCaseWords = words.filter((word) => /^[A-Z][a-z'.-]+$/.test(word)).length;
  return titleCaseWords === words.length ? 8 : 4;
}

function japaneseNameScore(line: string) {
  if (organizationPattern.test(line) || rolePattern.test(line) || /[0-9@]/.test(line)) return 0;
  const chunks = line.split(/[\s・]+/).filter(Boolean);
  if (chunks.length !== 2 || !chunks.every((chunk) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,8}$/u.test(chunk))) return 0;
  return 10;
}

function reconstructFragmentedLatinName(lines: string[], normalizedText: string) {
  const emailLocalParts = extractEmailCandidates(normalizedText).map((candidate) => candidate.value.split("@")[0].replace(/\d+/g, ""));
  const tokens = lines.flatMap((line, lineIndex) => line.split(/\s+/)
    .filter((word) => /^[A-Z][a-z'.-]{2,}$/.test(word))
    .map((word) => ({ word, lineIndex })));
  const anchored = tokens.filter((token) => emailLocalParts.some((local) => local.includes(token.word.toLowerCase())));
  for (const anchor of anchored) {
    const partner = tokens.find((token) => token !== anchor && Math.abs(token.lineIndex - anchor.lineIndex) <= 3);
    if (partner) return `${anchor.word} ${partner.word}`;
  }
  return "";
}

/** Assigns OCR lines by content instead of assuming the first three lines are name/company/role. */
export function extractContactFields(normalizedText: string): Pick<ContactInput, "name" | "company" | "role"> {
  const lines = normalizedText.split("\n").map(cleanCardLine).filter((line) => line && !contactLinePattern.test(line) && !phoneLinePattern.test(line));
  let company = "";
  let role = "";

  for (const line of lines) {
    const roleMatch = line.match(rolePattern);
    if (roleMatch) {
      const roleIndex = roleMatch.index ?? 0;
      const beforeRole = cleanCardLine(line.slice(0, roleIndex));
      if (!company && beforeRole && organizationPattern.test(beforeRole)) {
        company = beforeRole;
        role = cleanCardLine(line.slice(roleIndex));
      } else if (!role) {
        role = line;
      }
    }
    if (!company && organizationPattern.test(line)) {
      company = roleMatch && (roleMatch.index ?? 0) > 0 ? cleanCardLine(line.slice(0, roleMatch.index)) : line;
    }
  }

  const name = lines
    .map((line, index) => ({ line, index, score: Math.max(japaneseNameScore(line), latinNameScore(line)) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index)[0]?.line ?? "";
  const reconstructedName = reconstructFragmentedLatinName(lines, normalizedText);

  // Conservative fallbacks keep the form editable without assigning contact data as a person name.
  const unused = lines.filter((line) => line !== company && line !== role && !organizationPattern.test(line) && !rolePattern.test(line));
  return { name: reconstructedName || name || unused[0] || "", company, role };
}


function mostCommon(values: string[], prefer?: (value: string) => number) {
  const counts = new Map<string, { count: number; first: number }>();
  values.forEach((value, index) => { if (!value) return; const key = value.normalize("NFKC").replace(/\s+/g, " ").trim(); const c = counts.get(key); counts.set(key, c ? { ...c, count: c.count + 1 } : { count: 1, first: index }); });
  return [...counts.entries()].sort((a, b) => b[1].count - a[1].count || (prefer ? prefer(b[0]) - prefer(a[0]) : 0) || a[1].first - b[1].first)[0]?.[0] ?? "";
}

/**
 * Combines several OCR passes of the same card field by field: values that more passes agree on win,
 * and email candidates from every pass are kept (strict reads first). Each pass misreads different glyphs,
 * so voting recovers fields that any single pass gets wrong.
 */
export function mergeOcrResults(results: BusinessCardOcrResult[]): BusinessCardOcrResult {
  if (results.length === 1) return results[0];
  const pick = (field: keyof ContactInput, prefer?: (value: string) => number) => mostCommon(results.map((r) => r.fields[field] ?? ""), prefer);
  const emailOrder = new Map<string, { candidate: EmailCandidate; votes: number; strict: boolean }>();
  for (const r of results) for (const candidate of r.emailCandidates) {
    const current = emailOrder.get(candidate.value);
    emailOrder.set(candidate.value, current ? { ...current, votes: current.votes + 1, strict: current.strict || candidate.source === "strict" } : { candidate, votes: 1, strict: candidate.source === "strict" });
  }
  const emailCandidates = [...emailOrder.values()].sort((a, b) => Number(b.strict) - Number(a.strict) || b.votes - a.votes).map((x) => x.candidate);
  return {
    rawText: results.map((r) => r.rawText).join("\n\n--- 別パス ---\n"),
    normalizedText: results[0].normalizedText,
    emailCandidates,
    fields: {
      name: pick("name", (v) => Math.max(japaneseNameScore(v), latinNameScore(v))),
      company: pick("company", (v) => (organizationPattern.test(v) ? 1 : 0)),
      role: pick("role"),
      email: "",
      phone: pick("phone", (v) => (/^(?:0\d{1,4}-\d{1,4}-\d{3,4}|\+81)/.test(v) ? 1 : 0)),
      website: pick("website"),
    },
  };
}

export function parseBusinessCardText(rawText: string): BusinessCardOcrResult {
  const normalizedText = normalizeOcrText(rawText);
  const emailCandidates = extractEmailCandidates(rawText);
  const phone = normalizedText.match(phonePattern)?.[0] ?? "";
  const website = normalizedText.match(urlPattern)?.[0] ?? "";
  const identity = extractContactFields(normalizedText);
  return {
    rawText,
    normalizedText,
    emailCandidates,
    // Email intentionally stays empty until the user selects or manually enters it.
    fields: { ...identity, email: "", phone, website: website.startsWith("www.") ? `https://${website}` : website },
  };
}

type OcrWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let workerPromise: Promise<OcrWorker> | null = null;
let progressListener: ((event: { status: string; progress: number }) => void) | undefined;

/** One long-lived worker: loading the WASM core and language data is the slowest part of a scan. */
function getWorker() {
  workerPromise ??= (async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    // Keep the worker, WASM core, and language packs on the same origin. Besides
    // avoiding a runtime CDN dependency, this also makes installed PWA use stable
    // on corporate/mobile networks that block worker scripts from external hosts.
    const worker = await createWorker("jpn+eng", 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang",
      logger: (event) => progressListener?.(event),
    });
    // Sparse-text segmentation handles cards (text blocks scattered around logos) better than AUTO.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
    return worker;
  })().catch((cause) => { workerPromise = null; throw cause; });
  return workerPromise;
}

/** Start loading the OCR engine while the user is still framing the shot. */
export function warmUpOcr() { void getWorker().catch(() => undefined); }

export async function releaseOcr() {
  const pending = workerPromise; workerPromise = null;
  if (pending) await (await pending.catch(() => null))?.terminate();
}

/** Pass 1 looks incomplete → worth a second pass on a differently processed image. */
function needsSecondPass(result: BusinessCardOcrResult) {
  return !result.emailCandidates.some((candidate) => candidate.source === "strict") || !result.fields.name || !result.fields.phone || !result.fields.company;
}

/**
 * Pass 1 reads the photo as is. Only if a field is missing, pass 2 reads the card cropped out of the
 * background, shadow-corrected and binarized, and the two are merged field by field.
 * Benchmark (12 synthetic phone-photo cards × 5 fields): before 44/60 → 51/60, with pass 2 on 5 of 12 cards.
 */
export async function recognizeBusinessCard(image: Blob, onProgress?: (progress: OcrProgress) => void) {
  let pass = 0, passes = 1;
  progressListener = (event) => onProgress?.({ status: pass === 0 ? event.status : `${event.status}（補正して再読取）`, progress: Math.min(1, (pass + event.progress) / passes) });
  try {
    const worker = await getWorker();
    const first = parseBusinessCardText((await worker.recognize(image)).data.text);
    if (!needsSecondPass(first)) return first;
    try {
      const { binarizedCardVariant } = await import("@/lib/image-processing");
      const variant = await binarizedCardVariant(image);
      pass = 1; passes = 2;
      return mergeOcrResults([first, parseBusinessCardText((await worker.recognize(variant)).data.text)]);
    } catch (cause) {
      console.warn("second OCR pass skipped", cause);
      return first;
    }
  } finally {
    progressListener = undefined;
  }
}

export const tesseractProvider: OcrProvider = { recognize: recognizeBusinessCard };

/**
 * Google Cloud Vision via /api/ocr (much better on Japanese cards). Falls back to on-device
 * Tesseract when the server isn't configured, the network fails, or Vision returns nothing.
 */
export async function recognizeWithCloudVision(image: Blob, onProgress?: (progress: OcrProgress) => void): Promise<BusinessCardOcrResult> {
  try {
    onProgress?.({ status: "クラウドOCRで読み取り中", progress: 0.2 });
    const { appFetch } = await import("@/lib/client-api");
    const form = new FormData();
    form.set("image", new File([image], "business-card.jpg", { type: image.type || "image/jpeg" }));
    const result = await appFetch<{ text: string }>("/api/ocr", { method: "POST", body: form });
    onProgress?.({ status: "読み取り完了", progress: 1 });
    if (result.text.trim()) return parseBusinessCardText(result.text);
  } catch (cause) {
    console.warn("Cloud OCR unavailable, falling back to on-device OCR", cause);
  }
  return recognizeBusinessCard(image, onProgress);
}

export const cloudVisionProvider: OcrProvider = { recognize: recognizeWithCloudVision };
