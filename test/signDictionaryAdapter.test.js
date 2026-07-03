import test from "node:test";
import assert from "node:assert/strict";
import { parseApiPayload, SignDictionaryAdapter } from "../src/sign-dictionary/adapter.js";

test("parseApiPayload parses XML items", () => {
  const items = parseApiPayload("<response><body><items><item><title>ㅈ</title><localId>1</localId></item></items></body></response>");
  assert.equal(items[0].title, "ㅈ");
});

test("adapter normalizes dictionary entries", async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => "<response><body><items><item><title>ㅈ</title><subDescription>http://sldict.korean.go.kr/sample.mp4</subDescription><imageObject>http://sldict.korean.go.kr/tiny_215X161.jpg</imageObject><signImages>http://sldict.korean.go.kr/large_700X466.jpg</signImages><url>http://sldict.korean.go.kr/front/sign/signContentsView.do?origin_no=1</url></item></items></body></response>"
  });
  const adapter = new SignDictionaryAdapter({
    env: {
      CULTURE_API_INTEGRATED_KEY: "test",
      CULTURE_API_LIFE_URL: "",
      CULTURE_API_SPECIALIZED_URL: "",
      CULTURE_API_CULTURE_URL: "",
      CULTURE_API_INTEGRATED_URL: "https://example.com"
    },
    fetchImpl
  });
  const result = await adapter.searchEntries("ㅈ");
  assert.equal(result.status, "success");
  assert.equal(result.entries[0].title, "ㅈ");
  assert.equal(result.entries[0].videoUrl, "https://sldict.korean.go.kr/sample.mp4");
  assert.equal(result.entries[0].thumbnailUrl, "https://sldict.korean.go.kr/large_700X466.jpg");
});
