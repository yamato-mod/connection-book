import { describe, expect, it } from "vitest";
import { extractEmailCandidates, mergeOcrResults, parseBusinessCardText } from "../src/lib/ocr";
import { findCardBounds, sauvola, type Gray } from "../src/lib/image-filters";

describe("OCR text fixes found in the card benchmark", () => {
  it("separates an address glued to its E-mail label", () => {
    expect(extractEmailCandidates("E-mailtaro.yamada@sample.co.jp")[0].value).toBe("taro.yamada@sample.co.jp");
  });
  it("keeps a real mail@ local part", () => {
    expect(extractEmailCandidates("mail@example.jp")[0].value).toBe("mail@example.jp");
  });
  it("restores the dot before .or.jp / .co.jp", () => {
    expect(extractEmailCandidates("m.takahashi@machi-kyokai.orjp")[0]).toMatchObject({ value: "m.takahashi@machi-kyokai.or.jp", source: "corrected" });
  });
  it("restores a dotless domain without swallowing the next URL line", () => {
    expect(extractEmailCandidates("E-mail sakura.ito@greenleafjp\nhttps://www.example.jp")[0].value).toBe("sakura.ito@greenleaf.jp");
  });
  it("fixes 一般社団法人 read as ー般 and recognises 事務局長", () => {
    expect(parseBusinessCardText("ー般社団法人まちづくり協会\n事務局長\n高橋 美咲").fields).toMatchObject({ company: "一般社団法人まちづくり協会", role: "事務局長", name: "高橋 美咲" });
  });
  it("merges passes field by field", () => {
    const a = parseBusinessCardText("株式会社サンプル\n山田 太郎\nTEL 082-123-4567");
    const b = parseBusinessCardText("株式会社サンプル\n山田 太郎\ntaro@example.jp");
    const merged = mergeOcrResults([a, b]);
    expect(merged.fields).toMatchObject({ company: "株式会社サンプル", name: "山田 太郎", phone: "082-123-4567" });
    expect(merged.emailCandidates[0].value).toBe("taro@example.jp");
  });
});

function synthetic(width: number, height: number, card: { x: number; y: number; w: number; h: number }): Gray {
  const data = new Float32Array(width * height).fill(70);
  for (let y = card.y; y < card.y + card.h; y++) for (let x = card.x; x < card.x + card.w; x++) data[y * width + x] = 235;
  return { data, width, height };
}

describe("image filters", () => {
  it("finds a card on a dark desk", () => {
    const box = findCardBounds(synthetic(1200, 1600, { x: 200, y: 500, w: 820, h: 500 }))!;
    expect(box.x).toBeGreaterThan(150); expect(box.x).toBeLessThan(210);
    expect(box.width).toBeGreaterThan(800); expect(box.width).toBeLessThan(900);
  });
  it("returns null when the card fills the frame", () => {
    expect(findCardBounds(synthetic(1200, 700, { x: 0, y: 0, w: 1200, h: 700 }))).toBeNull();
  });
  it("binarizes dark text on a light card", () => {
    const img = synthetic(300, 200, { x: 0, y: 0, w: 300, h: 200 });
    for (let x = 100; x < 200; x++) img.data[100 * 300 + x] = 30;
    const out = sauvola(img);
    expect(out.data[100 * 300 + 150]).toBe(0); expect(out.data[20 * 300 + 20]).toBe(255);
  });
});
