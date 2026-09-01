import assert from "node:assert/strict";
import test from "node:test";
import { INTERVIEW_FIELDS, INTERVIEW_QUESTIONS, nextInterviewIndex } from "../src/lib/onboarding-interview.ts";

test("guided interview is deterministic and allowlisted", () => {
  assert.equal(INTERVIEW_QUESTIONS.length, 8);
  assert.deepEqual([...INTERVIEW_FIELDS].sort(), ["growth_priorities", "hard_boundaries", "interests", "niches_themes", "short_bio", "stage_name", "voice_summary"]);
  assert.equal(nextInterviewIndex({}), 0);
  assert.equal(nextInterviewIndex({ stage_name: "Name", short_bio: "Bio", voice_summary: "Warm", interests: "Art", niches_themes: "Portraits", hard_boundaries: "No finance claims", growth_priorities: "Reach" }), 7);
});

test("guided interview source uses only the confirmation allowlist", async () => {
  const readFile = (await import("node:fs/promises")).readFile;
  const [action, component] = await Promise.all([
    readFile(new URL("../src/app/onboarding/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/guided-onboarding-interview.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(action, /INTERVIEW_FIELDS\.has\(field\)/);
  assert.match(action, /Guided answers can only be confirmed by the creator/);
  assert.match(component, /state\.ok && state\.message/);
  assert.match(component, /answer \?\?/);
  for (const restricted of ["legal_name", "date_of_birth", "contact_phone", "login_email", "password", "pin"]) {
    assert.equal(INTERVIEW_FIELDS.has(restricted), false);
  }
});
