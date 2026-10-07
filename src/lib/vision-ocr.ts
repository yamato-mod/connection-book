import "server-only";
import { isConfiguredValue } from "@/lib/env-config";

/**
 * Google Cloud Vision DOCUMENT_TEXT_DETECTION. Tesseract (on-device) struggles with Japanese
 * business cards: small type, logos, mixed vertical/horizontal layout. Vision handles these far better.
 * Auth is a server-only API key restricted to the Cloud Vision API (GOOGLE_VISION_API_KEY).
 */
export function isVisionConfigured() {
  return isConfiguredValue(process.env.GOOGLE_VISION_API_KEY);
}

export class VisionOcrError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type VisionResponse = {
  responses?: Array<{ fullTextAnnotation?: { text?: string }; textAnnotations?: Array<{ description?: string }>; error?: { code?: number; message?: string } }>;
  error?: { code?: number; message?: string };
};

export function textFromVisionResponse(payload: VisionResponse) {
  const first = payload.responses?.[0];
  const error = payload.error ?? first?.error;
  if (error) throw new VisionOcrError(error.message ?? "Vision API error", error.code ?? 500);
  return first?.fullTextAnnotation?.text ?? first?.textAnnotations?.[0]?.description ?? "";
}

export async function visionDocumentText(image: Buffer, fetchImpl: typeof fetch = fetch) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!isConfiguredValue(key)) throw new VisionOcrError("GOOGLE_VISION_API_KEY is not configured", 503);
  const response = await fetchImpl(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key!)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: image.toString("base64") },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["ja", "en"] },
      }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => ({}))) as VisionResponse;
  if (!response.ok) throw new VisionOcrError(payload.error?.message ?? `Vision API HTTP ${response.status}`, response.status);
  return textFromVisionResponse(payload);
}
