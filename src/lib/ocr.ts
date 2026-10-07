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
const rolePattern = /代表取締役|取締役|執行役員|副代表|共同代表|代表|会長|社長|副社長|専務|常務|本部長|事業部長|部長|次長|課長|室長|支店長|店長|係長|主任|顧問|理事|監事|教授|准教授|講師|マネージャー|ディレクター|プロデューサー|エンジニア|デザイナー|コンサルタント|ファウンダー|創業者|CEO|COO|CFO|CTO|CMO|CIO/i;
const contactLinePattern = /@|(?:https?:\/\/|www\.)|(?:^|\s)(?:tel|phone|mobile|fax|mail|e-mail|email|〒)\s*[:：]?/i;

/** Normalizes OCR typography without making ambiguous O/0, I/l, or rn/m substitutions. */
export function normalizeOcrText(text: string) {
  return text
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

function strictCandidates(text: string): EmailCandidate[] {
  return (text.match(strictEmailPattern) ?? []).map((original) => ({
    value: normalizeEmailCandidate(original), source: "strict", original, warnings: [],
  }));
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
  corrected = corrected
    .replace(/\s*@\s*/g, "@")
    .replace(/(?<=[a-z0-9._%+-])\s*\n\s*(?=[a-z0-9.-])/gi, "")
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

function identityRecognitionScore(text: string) {
  const normalized = normalizeOcrText(text);
  const lines = normalized.split("\n").map(cleanCardLine).filter(Boolean);
  const nameScore = Math.max(0, ...lines.map((line) => Math.max(japaneseNameScore(line), latinNameScore(line))));
  const organizationScore = lines.some((line) => organizationPattern.test(line)) ? 4 : 0;
  const roleScore = lines.some((line) => rolePattern.test(line)) ? 4 : 0;
  return nameScore + organizationScore + roleScore;
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

export async function recognizeBusinessCard(image: Blob, onProgress?: (progress: OcrProgress) => void) {
  const { createWorker, PSM } = await import("tesseract.js");
  // Keep the worker, WASM core, and language packs on the same origin. Besides
  // avoiding a runtime CDN dependency, this also makes installed PWA use stable
  // on corporate/mobile networks that block worker scripts from external hosts.
  let recognitionPass: "auto" | "sparse" = "auto";
  const worker = await createWorker("jpn+eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    logger: (event) => onProgress?.({
      status: recognitionPass === "auto" ? event.status : `${event.status}（再認識）`,
      progress: recognitionPass === "auto" ? event.progress * 0.65 : 0.65 + event.progress * 0.35,
    }),
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
    const autoResult = await worker.recognize(image);
    const autoParsed = parseBusinessCardText(autoResult.data.text);
    const autoIdentityScore = identityRecognitionScore(autoResult.data.text);
    if (autoIdentityScore >= 8) return autoParsed;

    // Business cards often scatter name/title blocks around logos. If AUTO could
    // not find a credible person name, retry once with sparse-text segmentation.
    recognitionPass = "sparse";
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
    const sparseResult = await worker.recognize(image);
    const sparseParsed = parseBusinessCardText(sparseResult.data.text);
    const sparseIdentityScore = identityRecognitionScore(sparseResult.data.text);
    const preferred = sparseIdentityScore > autoIdentityScore ? sparseParsed : autoParsed;
    const fallback = preferred === autoParsed ? sparseParsed : autoParsed;
    return {
      ...preferred,
      emailCandidates: uniqueCandidates([...preferred.emailCandidates, ...fallback.emailCandidates]),
      fields: {
        ...preferred.fields,
        phone: preferred.fields.phone || fallback.fields.phone,
        website: preferred.fields.website || fallback.fields.website,
      },
    };
  } finally {
    await worker.terminate();
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
