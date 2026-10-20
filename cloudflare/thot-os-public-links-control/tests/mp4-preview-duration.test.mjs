import assert from "node:assert/strict";
import test from "node:test";
import { isShortMp4Preview } from "../src/mp4-preview-duration.ts";

function box(type, ...parts) {
  const body = Buffer.concat(parts.map((part) => Buffer.from(part)));
  const result = Buffer.alloc(8 + body.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  body.copy(result, 8);
  return result;
}
function durationBox(type, seconds) {
  const data = Buffer.alloc(20);
  data.writeUInt32BE(1000, 12);
  data.writeUInt32BE(seconds * 1000, 16);
  return box(type, data);
}
function sampleTable(seconds, sampleCount = 30) {
  const stts = Buffer.alloc(16);
  stts.writeUInt32BE(1, 4);
  stts.writeUInt32BE(sampleCount, 8);
  stts.writeUInt32BE(sampleCount ? Math.floor(seconds * 1000 / sampleCount) : 1000, 12);
  const stsz = Buffer.alloc(12);
  stsz.writeUInt32BE(sampleCount, 8);
  return box("stbl", box("stts", stts), box("stsz", stsz));
}
function mp4(seconds, options = {}) {
  const hdlr = Buffer.alloc(12); hdlr.write("vide", 8, 4, "ascii");
  const mdia = box("mdia", durationBox("mdhd", seconds), box("hdlr", hdlr), box("minf", sampleTable(seconds, options.sampleCount)));
  const moov = box("moov", durationBox("mvhd", seconds), box("trak", mdia), ...(options.fragmented ? [box("mvex", Buffer.alloc(0))] : []));
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")), moov, box("mdat", Buffer.from("fixture-video-payload"))]);
}

test("a bounded non-fragmented MP4 is accepted, while long or ambiguous timelines fail closed", () => {
  assert.equal(isShortMp4Preview(mp4(30)), true);
  assert.equal(isShortMp4Preview(mp4(60)), true);
  assert.equal(isShortMp4Preview(mp4(61)), false);
  assert.equal(isShortMp4Preview(mp4(30, { fragmented: true })), false);
  assert.equal(isShortMp4Preview(mp4(30, { sampleCount: 0 })), false);
  const malformed = mp4(30);
  malformed.writeUInt32BE(0xffffffff, 0);
  assert.equal(isShortMp4Preview(malformed), false);
});
