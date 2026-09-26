import { describe, expect, it } from "vitest";
import { extractContactFields, extractEmailCandidates, normalizeEmailCandidate, normalizeOcrText, parseBusinessCardText } from "../src/lib/ocr";

const values = (text: string) => extractEmailCandidates(text).map((candidate) => candidate.value);

describe("OCR email normalization and extraction", () => {
  it.each([
    ["taro@example.com", "taro@example.com"],
    ["taro.yamada@example.co.jp", "taro.yamada@example.co.jp"],
    ["taro . yamada @ example . co . jp", "taro.yamada@example.co.jp"],
    ["taro.yamada＠example.co.jp", "taro.yamada@example.co.jp"],
    ["taro.yamada@example。co。jp", "taro.yamada@example.co.jp"],
    ["taro.yamada@\nexample.co.jp", "taro.yamada@example.co.jp"],
  ])("extracts %s", (input, expected) => {
    expect(values(input)).toContain(expected);
  });

  it("normalizes full-width alphanumerics, symbols, whitespace, and invisible characters", () => {
    expect(normalizeOcrText("ｔａｒｏ ． ｙａｍａｄａ ＠\u200B ｅｘａｍｐｌｅ ． ｃｏ ． ｊｐ")).toBe("taro.yamada@example.co.jp");
  });

  it.each(["taro(at)example.com", "taro[at]example.com"])("marks OCR punctuation correction as a candidate: %s", (input) => {
    expect(extractEmailCandidates(input)[0]).toMatchObject({ value: "taro@example.com", source: "corrected" });
  });

  it("considers a comma as a dot only in fallback extraction", () => {
    expect(extractEmailCandidates("taro@example,com")[0]).toMatchObject({ value: "taro@example.com", source: "corrected" });
  });

  it("does not perform ambiguous O/0, I/l, or rn/m replacements", () => {
    expect(normalizeEmailCandidate("I0rn@example.com")).toBe("i0rn@example.com");
  });

  it("returns every unique address but never auto-selects one", () => {
    const result = parseBusinessCardText("taro@example.com\nsales@example.co.jp\ntaro@example.com");
    expect(result.emailCandidates.map((candidate) => candidate.value)).toEqual(["taro@example.com", "sales@example.co.jp"]);
    expect(result.fields.email).toBe("");
  });

  it("returns no candidate for non-email text", () => {
    expect(extractEmailCandidates("株式会社ABC 営業部 山田太郎")).toEqual([]);
  });
});

describe("business-card identity field assignment", () => {
  it("splits an organization and role, then prefers a clear romanized person name", () => {
    const fields = extractContactFields("広島大学起業部 副代表\n森岡 HITE\nKazutoshi Morioka\n090-6716-7804");
    expect(fields).toEqual({ name: "Kazutoshi Morioka", company: "広島大学起業部", role: "副代表" });
  });

  it("recognizes conventional Japanese company, role, and person lines in any order", () => {
    const fields = extractContactFields("株式会社ABC\n営業部 部長\n山田 太郎\ntaro@example.com");
    expect(fields).toEqual({ name: "山田 太郎", company: "株式会社ABC", role: "営業部 部長" });
  });

  it("does not treat contact details as a name fallback", () => {
    const result = parseBusinessCardText("TEL 090-1234-5678\nmail@example.com\nwww.example.com");
    expect(result.fields.name).toBe("");
  });

  it("reconstructs a split romanized name when the email local part anchors the given name", () => {
    const raw = "SEY\nMorioka\n3\nSE         Kazutoshi\nTape (機械科)\nTEL : 090-6716-7804\nE-mail(Biz): kazutoshi9981@gmail.com";
    expect(parseBusinessCardText(raw).fields.name).toBe("Kazutoshi Morioka");
  });
});
