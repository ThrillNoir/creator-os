import assert from "node:assert/strict";
import test from "node:test";
import { INTERVIEW_FIELDS, INTERVIEW_QUESTIONS, nextInterviewIndex } from "../src/lib/onboarding-interview.ts";

test("guided interview is deterministic and allowlisted", () => {
  assert.equal(INTERVIEW_QUESTIONS.length, 9);
  assert.deepEqual([...INTERVIEW_FIELDS].sort(), ["content_pillars", "forbidden_topics_claims", "primary_audience", "stage_name", "voice_summary"]);
  assert.equal(nextInterviewIndex({}), 2);
  assert.equal(nextInterviewIndex({ stage_name: "Name", voice_summary: "Warm", forbidden_topics_claims: "Nope", primary_audience: "Fans", content_pillars: "Art" }), 8);
});

test("guided interview source uses only the confirmation allowlist", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/app/onboarding/actions.ts", import.meta.url), "utf8");
  assert.match(source, /interviewFields\.has\(field\)/);
  assert.match(source, /Guided answers can only be confirmed by the creator/);
});
