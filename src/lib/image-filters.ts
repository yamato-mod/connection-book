/**
 * Pure pixel filters for business-card OCR. They operate on RGBA buffers so the same
 * code runs in the browser (canvas ImageData) and in Node benchmarks/tests.
 */
export type Rgba = { data: Uint8ClampedArray; width: number; height: number };
export type Gray = { data: Float32Array; width: number; height: number };
export type Box = { x: number; y: number; width: number; height: number };

export function toGray(image: Rgba): Gray {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = 0.2126 * image.data[p] + 0.7152 * image.data[p + 1] + 0.0722 * image.data[p + 2];
  return { data: out, width: image.width, height: image.height };
}

export function grayToRgba(gray: Gray): Rgba {
  const data = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0, p = 0; i < gray.data.length; i++, p += 4) { const v = gray.data[i]; data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255; }
  return { data, width: gray.width, height: gray.height };
}

/** Summed-area tables of value and value² (Float64 to keep precision on large images). */
function integrals(gray: Gray) {
  const w = gray.width + 1, h = gray.height + 1;
  const sum = new Float64Array(w * h), sq = new Float64Array(w * h);
  for (let y = 1; y < h; y++) {
    let rowSum = 0, rowSq = 0;
    for (let x = 1; x < w; x++) {
      const v = gray.data[(y - 1) * gray.width + (x - 1)];
      rowSum += v; rowSq += v * v;
      sum[y * w + x] = sum[(y - 1) * w + x] + rowSum;
      sq[y * w + x] = sq[(y - 1) * w + x] + rowSq;
    }
  }
  return { sum, sq, w };
}

function windowStats(t: ReturnType<typeof integrals>, gray: Gray, x: number, y: number, r: number) {
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(gray.width, x + r + 1), y1 = Math.min(gray.height, y + r + 1);
  const n = (x1 - x0) * (y1 - y0), w = t.w;
  const s = t.sum[y1 * w + x1] - t.sum[y0 * w + x1] - t.sum[y1 * w + x0] + t.sum[y0 * w + x0];
  const q = t.sq[y1 * w + x1] - t.sq[y0 * w + x1] - t.sq[y1 * w + x0] + t.sq[y0 * w + x0];
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, q / n - mean * mean)) };
}

/** Bilinear downscale of a gray image (used for cheap analysis passes). */
export function resizeGray(gray: Gray, width: number, height: number): Gray {
  const out = new Float32Array(width * height), sx = gray.width / width, sy = gray.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = Math.min(gray.width - 1, (x + 0.5) * sx - 0.5), gy = Math.min(gray.height - 1, (y + 0.5) * sy - 0.5);
    const x0 = Math.max(0, Math.floor(gx)), y0 = Math.max(0, Math.floor(gy)), x1 = Math.min(gray.width - 1, x0 + 1), y1 = Math.min(gray.height - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0, d = gray.data, w = gray.width;
    out[y * width + x] = (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
  }
  return { data: out, width, height };
}

function otsu(values: Float32Array) {
  const hist = new Float64Array(256);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  let total = 0, sumAll = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sumAll += i * hist[i]; }
  let best = 127, bestVar = -1, wB = 0, sumB = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

/**
 * Finds the business card in a photo: the largest bright connected region that looks like a card.
 * Returns null (= use the whole image) when nothing card-like is found, e.g. the card fills the frame.
 */
export function findCardBounds(gray: Gray): Box | null {
  const scale = 400 / Math.max(gray.width, gray.height);
  if (scale >= 1) return null;
  const small = resizeGray(gray, Math.max(1, Math.round(gray.width * scale)), Math.max(1, Math.round(gray.height * scale)));
  const threshold = otsu(small.data);
  const { width: w, height: h } = small, labels = new Int32Array(w * h).fill(-1);
  let best = { count: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== -1 || small.data[start] <= threshold) continue;
    const region = { count: 0, minX: w, minY: h, maxX: 0, maxY: 0 };
    labels[start] = start; stack.push(start);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      region.count++; region.minX = Math.min(region.minX, x); region.maxX = Math.max(region.maxX, x); region.minY = Math.min(region.minY, y); region.maxY = Math.max(region.maxY, y);
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && labels[q] === -1 && small.data[q] > threshold) { labels[q] = start; stack.push(q); }
      }
    }
    if (region.count > best.count) best = region;
  }
  const boxW = best.maxX - best.minX + 1, boxH = best.maxY - best.minY + 1;
  const areaRatio = (boxW * boxH) / (w * h), fill = best.count / (boxW * boxH), aspect = Math.max(boxW, boxH) / Math.min(boxW, boxH);
  // A card covers a decent part of the frame, is mostly solid, and has a card-ish aspect ratio.
  if (areaRatio < 0.08 || areaRatio > 0.92 || fill < 0.6 || aspect < 1.2 || aspect > 2.4) return null;
  const margin = 0.02 * Math.max(boxW, boxH);
  const x0 = Math.max(0, (best.minX - margin) / scale), y0 = Math.max(0, (best.minY - margin) / scale);
  const x1 = Math.min(gray.width, (best.maxX + 1 + margin) / scale), y1 = Math.min(gray.height, (best.maxY + 1 + margin) / scale);
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}

/**
 * Evens out shadows/gradients by dividing by a blurred background estimate, then stretches contrast.
 * Thin strokes survive (no thresholding), light-gray small print gets darker.
 */
export function normalizeIllumination(gray: Gray): Gray {
  const r = Math.max(8, Math.round(Math.max(gray.width, gray.height) / 40));
  // Background ≈ local bright level: blur of a max-ish estimate (mean + std keeps text from pulling it down).
  const t = integrals(gray);
  const out = new Float32Array(gray.data.length);
  for (let y = 0; y < gray.height; y++) for (let x = 0; x < gray.width; x++) {
    const { mean, std } = windowStats(t, gray, x, y, r);
    const background = Math.max(1, Math.min(255, mean + std));
    out[y * gray.width + x] = Math.min(255, (gray.data[y * gray.width + x] / background) * 255);
  }
  // Percentile stretch: 1% darkest → 0, 99% → 255.
  const sorted = Float32Array.from(out.filter((_, i) => i % 7 === 0)).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.99)];
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, ((out[i] - lo) / span) * 255));
  return { data: out, width: gray.width, height: gray.height };
}

/** Sauvola adaptive binarization — robust to uneven lighting; used as an alternative OCR pass. */
export function sauvola(gray: Gray, k = 0.2): Gray {
  const r = Math.max(10, Math.round(Math.max(gray.width, gray.height) / 60));
  const t = integrals(gray), out = new Float32Array(gray.data.length);
  for (let y = 0; y < gray.height; y++) for (let x = 0; x < gray.width; x++) {
    const { mean, std } = windowStats(t, gray, x, y, r);
    out[y * gray.width + x] = gray.data[y * gray.width + x] > mean * (1 + k * (std / 128 - 1)) ? 255 : 0;
  }
  return { data: out, width: gray.width, height: gray.height };
}

export function cropGray(gray: Gray, box: Box): Gray {
  const out = new Float32Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) out.set(gray.data.subarray((box.y + y) * gray.width + box.x, (box.y + y) * gray.width + box.x + box.width), y * box.width);
  return { data: out, width: box.width, height: box.height };
}

/** Target size for the card itself: small print needs ~30px x-height for Tesseract's LSTM. */
export function cardTargetScale(longSide: number) {
  return Math.min(3200 / longSide, Math.max(2400 / longSide, 1));
}
