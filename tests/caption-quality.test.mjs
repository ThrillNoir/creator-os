import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCaption } from "../src/lib/caption-quality.ts";

test("blocks an empty caption", () => {
  const issues = evaluateCaption({ caption: "  ", platform: "instagram" });
  assert.equal(issues[0]?.code, "empty");
  assert.equal(issues[0]?.severity, "blocker");
});

test("blocks captions over the destination limit", () => {
  const issues = evaluateCaption({ caption: "x".repeat(281), platform: "x" });
  assert.ok(issues.some((issue) => issue.code === "length" && issue.severity === "blocker"));
});

test("allows attached people tags and blocks unknown handles", () => {
  const allowed = evaluateCaption({ caption: "With @adelaide", platform: "instagram", allowedHandles: ["@adelaide"] });
  const blocked = evaluateCaption({ caption: "With @someone_else", platform: "instagram", allowedHandles: ["@adelaide"] });
  assert.equal(allowed.some((issue) => issue.code === "unknown_tags"), false);
  assert.equal(blocked.some((issue) => issue.code === "unknown_tags"), true);
});

test("warns about generic phrasing and repeated openings", () => {
  const issues = evaluateCaption({
    caption: "Step into your power in the late light.",
    platform: "instagram",
    recentCaptions: ["Step into your power in the late light. Another ending."],
  });
  assert.ok(issues.some((issue) => issue.code === "voice_phrase"));
  assert.ok(issues.some((issue) => issue.code === "repeated_opening"));
});
