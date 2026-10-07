import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { textFromVisionResponse, visionDocumentText, VisionOcrError } from "../src/lib/vision-ocr";
import { parseBusinessCardText } from "../src/lib/ocr";

describe("Google Cloud Vision OCR", () => {
  afterEach(() => { delete process.env.GOOGLE_VISION_API_KEY; });
  it("reads fullTextAnnotation text", () => {
    expect(textFromVisionResponse({ responses: [{ fullTextAnnotation: { text: "田中 美咲\n株式会社ABC" } }] })).toBe("田中 美咲\n株式会社ABC");
  });
  it("surfaces per-image errors", () => {
    expect(() => textFromVisionResponse({ responses: [{ error: { code: 7, message: "billing disabled" } }] })).toThrow(VisionOcrError);
  });
  it("refuses to call without an API key", async () => {
    await expect(visionDocumentText(Buffer.from("x"))).rejects.toMatchObject({ status: 503 });
  });
  it("sends DOCUMENT_TEXT_DETECTION with ja/en hints and returns text", async () => {
    process.env.GOOGLE_VISION_API_KEY = "test-key-value-123";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: "OK" } }] }), { status: 200 }));
    await expect(visionDocumentText(Buffer.from("img"), fetchMock as unknown as typeof fetch)).resolves.toBe("OK");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("vision.googleapis.com/v1/images:annotate");
    const body = JSON.parse(String(init.body));
    expect(body.requests[0].features[0].type).toBe("DOCUMENT_TEXT_DETECTION");
    expect(body.requests[0].imageContext.languageHints).toEqual(["ja", "en"]);
  });
  it("feeds Vision text into the existing card parser", () => {
    const parsed = parseBusinessCardText("株式会社サンプル商事\n代表取締役\n山田 太郎\nTEL 082-123-4567\ntaro@example.jp");
    expect(parsed.fields).toMatchObject({ company: "株式会社サンプル商事", name: "山田 太郎", phone: "082-123-4567" });
    expect(parsed.emailCandidates[0].value).toBe("taro@example.jp");
  });
});
