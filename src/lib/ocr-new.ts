import { parseBusinessCardText, type BusinessCardOcrResult } from "./ocr";

export function decodeCtc(data: ArrayLike<number>, time: number, classes: number, characters: string): string {
  const chars = Array.from(characters);
  let previous = -1, result = "";
  for (let t = 0; t < time; t++) {
    let best = 0;
    for (let c = 1; c < classes; c++) if (data[t * classes + c] > data[t * classes + best]) best = c;
    if (best !== 0 && best !== previous) result += chars[best - 1] ?? "";
    previous = best;
  }
  return result;
}

export function chooseValidValue(preferred: string, fallback: string, kind: "email" | "phone" | "website") {
  const valid = (value: string) => {
    if (kind === "email") return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
    if (kind === "phone") return /^[+\d][\d\s()\-]{6,}$/.test(value) && value.replace(/\D/g, "").length >= 9;
    try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes("."); } catch { return false; }
  };
  return !valid(preferred) && valid(fallback) ? fallback : preferred;
}

export function mergeOcrResults(preferred: BusinessCardOcrResult, fallback: BusinessCardOcrResult): BusinessCardOcrResult {
  const preferredEmail = preferred.emailCandidates[0]?.value ?? "";
  const fallbackEmail = fallback.emailCandidates[0]?.value ?? "";
  const chosen = chooseValidValue(preferredEmail, fallbackEmail, "email");
  return { ...preferred, emailCandidates: chosen === fallbackEmail && chosen !== preferredEmail ? fallback.emailCandidates : preferred.emailCandidates,
    fields: { ...preferred.fields, phone: chooseValidValue(preferred.fields.phone ?? "", fallback.fields.phone ?? "", "phone"), website: chooseValidValue(preferred.fields.website ?? "", fallback.fields.website ?? "", "website") } };
}

async function cachedAsset(url: string): Promise<Response> {
  let cache: Cache | undefined;
  try { void caches.delete("card-ocr-v1"); } catch { /* 旧モデルの片付け */ }
  try { cache = await caches.open("card-ocr-v2"); const hit = await cache.match(url); if (hit) return hit; } catch { /* cache unavailable */ }
  const response = await fetch(url);
  if (!response.ok) throw new Error("OCR asset unavailable");
  try { await cache?.put(url, response.clone()); } catch { /* quota or private browsing */ }
  return response;
}

export async function recognizeNewModel(image: Blob, signal: AbortSignal): Promise<BusinessCardOcrResult> {
  const check = () => { if (signal.aborted) throw new Error("timeout"); };
  const [{ createWorker, PSM }, ort, model, characters] = await Promise.all([
    import("tesseract.js"), import("onnxruntime-web/wasm"),
    cachedAsset("/models/card-ocr-v2/recognizer.onnx").then(r => r.arrayBuffer()),
    cachedAsset("/models/card-ocr-v2/characters.txt").then(r => r.text()),
  ]);
  check();
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;
  const worker = await createWorker("jpn+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract/core", langPath: "/tesseract/lang" });
  const stopWorker = () => { void worker.terminate().catch(() => {}); };
  signal.addEventListener("abort", stopWorker, { once: true });
  try {
    check();
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
    const result = await worker.recognize(image, {}, { blocks: true });
    check();
    const lines = (result.data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines)).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    if (!lines.length) throw new Error("No lines detected");
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    let bitmap: ImageBitmap | undefined;
    try {
      check();
      bitmap = await createImageBitmap(image);
      const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 64;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Canvas unavailable");
      const texts: string[] = [];
      for (const line of lines) {
        check();
        const { x0, y0, x1, y1 } = line.bbox;
        const x = Math.max(0, Math.floor(x0)), y = Math.max(0, Math.floor(y0));
        const w = Math.min(bitmap.width, Math.ceil(x1)) - x, h = Math.min(bitmap.height, Math.ceil(y1)) - y;
        if (w <= 0 || h <= 0) continue;
        const width = Math.max(1, Math.min(512, Math.round(w * 64 / h)));
        ctx.clearRect(0, 0, 512, 64); ctx.drawImage(bitmap, x, y, w, h, 0, 0, width, 64);
        if (width < 512) ctx.drawImage(canvas, width - 1, 0, 1, 64, width, 0, 512 - width, 64);
        const rgba = ctx.getImageData(0, 0, 512, 64).data, pixels = new Float32Array(512 * 64);
        for (let i = 0; i < pixels.length; i++) pixels[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 127.5 - 1;
        const output = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", pixels, [1, 1, 64, 512]) });
        const tensor = output[session.outputNames[0]];
        texts.push(decodeCtc(tensor.data as Float32Array, Number(tensor.dims[1]), Number(tensor.dims[2]), characters));
      }
      const text = texts.filter(Boolean).join("\n"); if (!text) throw new Error("No recognized text");
      return parseBusinessCardText(text);
    } finally { bitmap?.close(); await session.release(); }
  } finally { signal.removeEventListener("abort", stopWorker); if (!signal.aborted) await worker.terminate(); }
}

export async function tryNewOcr(image: Blob, fallback: BusinessCardOcrResult): Promise<{ result: BusinessCardOcrResult; used: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const result = await Promise.race([recognizeNewModel(image, controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, 20000); })]);
    return { result: mergeOcrResults(result, fallback), used: true };
  } catch { return { result: fallback, used: false }; }
  finally { if (timer) clearTimeout(timer); }
}
