import { cardTargetScale, findCardBounds, grayToRgba, normalizeIllumination, sauvola, toGray } from "@/lib/image-filters";

export type NormalizedRect = { x: number; y: number; width: number; height: number };

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.94) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像を生成できませんでした")), type, quality));
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function orientedBitmap(source: Blob): Promise<DecodedImage> {
  // Pixel Ultra HDR / large camera JPEGs can leave createImageBitmap pending on
  // some Android Chrome versions. HTMLImageElement decoding is more reliable,
  // and current mobile browsers apply EXIF orientation before canvas drawing.
  const url = URL.createObjectURL(source);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("画像の読み込みがタイムアウトしました")), 20_000)),
    ]);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (cause) {
    URL.revokeObjectURL(url);
    throw cause;
  }
}

export async function preprocessBusinessCardImage(source: Blob) {
  const bitmap = await orientedBitmap(source);
  const minimumLongSide = 1800;
  const maximumLongSide = 2800;
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(maximumLongSide / longSide, Math.max(1, minimumLongSide / longSide));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("画像処理を初期化できませんでした");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap.source, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // Gentle grayscale and contrast enhancement; avoid thresholding that crushes thin glyphs.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = 0.2126 * pixels.data[index] + 0.7152 * pixels.data[index + 1] + 0.0722 * pixels.data[index + 2];
    const enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.16 + 128));
    pixels.data[index] = enhanced;
    pixels.data[index + 1] = enhanced;
    pixels.data[index + 2] = enhanced;
  }
  context.putImageData(pixels, 0, 0);
  return canvasToBlob(canvas);
}

export async function rotateImage(source: Blob, clockwiseDegrees: 90 | -90) {
  const bitmap = await orientedBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像回転を初期化できませんでした");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(clockwiseDegrees * Math.PI / 180);
  context.drawImage(bitmap.source, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  return canvasToBlob(canvas);
}

export async function cropImageRegion(source: Blob, region: NormalizedRect) {
  const bitmap = await orientedBitmap(source);
  const sourceX = Math.max(0, Math.round(region.x * bitmap.width));
  const sourceY = Math.max(0, Math.round(region.y * bitmap.height));
  const sourceWidth = Math.max(1, Math.min(bitmap.width - sourceX, Math.round(region.width * bitmap.width)));
  const sourceHeight = Math.max(1, Math.min(bitmap.height - sourceY, Math.round(region.height * bitmap.height)));
  const scale = Math.min(3, Math.max(1, 1800 / Math.max(sourceWidth, sourceHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("範囲切り抜きを初期化できませんでした");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap.source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return preprocessBusinessCardImage(await canvasToBlob(canvas));
}

/**
 * Second OCR input: the card cropped out of the background, scaled so small print is legible,
 * shadow-corrected and Sauvola-binarized. Used alongside the plain image (see recognizeBusinessCard).
 */
export async function binarizedCardVariant(source: Blob) {
  const bitmap = await orientedBitmap(source);
  const probe = document.createElement("canvas");
  probe.width = bitmap.width; probe.height = bitmap.height;
  const probeContext = probe.getContext("2d", { willReadFrequently: true });
  if (!probeContext) throw new Error("画像処理を初期化できませんでした");
  probeContext.drawImage(bitmap.source, 0, 0);
  const full = probeContext.getImageData(0, 0, probe.width, probe.height);
  const box = findCardBounds(toGray(full)) ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const scale = cardTargetScale(Math.max(box.width, box.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.width * scale); canvas.height = Math.round(box.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("画像処理を初期化できませんでした");
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(bitmap.source, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const binary = grayToRgba(sauvola(normalizeIllumination(toGray(context.getImageData(0, 0, canvas.width, canvas.height)))));
  context.putImageData(new ImageData(binary.data as Uint8ClampedArray<ArrayBuffer>, binary.width, binary.height), 0, 0);
  return canvasToBlob(canvas, "image/png");
}
