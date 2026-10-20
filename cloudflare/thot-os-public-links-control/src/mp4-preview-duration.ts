// A conservative ISO BMFF check for a short, non-fragmented MP4. Unusual or
// incomplete files are rejected instead of being guessed from byte size.
const MAX_SECONDS = 60n;
const MAX_MOOV_BYTES = 8 * 1024 * 1024;
type Box = { type: string; start: number; body: number; end: number };

function boxes(view: DataView, start: number, end: number): Box[] | null {
  const result: Box[] = [];
  for (let offset = start; offset < end;) {
    if (end - offset < 8 || result.length > 20000) return null;
    const size32 = view.getUint32(offset);
    let header = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16) return null;
      const wide = view.getBigUint64(offset + 8);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(wide);
      header = 16;
    } else if (size32 === 0) size = end - offset;
    if (size < header || size > end - offset) return null;
    const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    result.push({ type, start: offset, body: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}

function child(view: DataView, parent: Box, type: string) {
  const values = boxes(view, parent.body, parent.end);
  return values?.find((box) => box.type === type) ?? null;
}

function duration(view: DataView, box: Box) {
  if (box.end - box.body < 20) return null;
  const version = view.getUint8(box.body);
  const timescaleOffset = version === 0 ? 12 : version === 1 ? 20 : -1;
  const durationOffset = version === 0 ? 16 : version === 1 ? 24 : -1;
  if (timescaleOffset < 0 || box.end - box.body < durationOffset + (version === 0 ? 4 : 8)) return null;
  const timescale = BigInt(view.getUint32(box.body + timescaleOffset));
  const ticks = version === 0 ? BigInt(view.getUint32(box.body + durationOffset)) : view.getBigUint64(box.body + durationOffset);
  return timescale > 0n && ticks > 0n && ticks <= timescale * MAX_SECONDS ? timescale : null;
}

function sampleDuration(view: DataView, stts: Box, stsz: Box, timescale: bigint) {
  if (stts.end - stts.body < 8 || stsz.end - stsz.body < 12 || view.getUint8(stts.body) !== 0) return false;
  const count = view.getUint32(stts.body + 4);
  if (count < 1 || count > 20000 || stts.end - stts.body !== 8 + count * 8) return false;
  let samples = 0n;
  let ticks = 0n;
  for (let index = 0; index < count; index += 1) {
    const offset = stts.body + 8 + index * 8;
    const sampleCount = BigInt(view.getUint32(offset));
    const delta = BigInt(view.getUint32(offset + 4));
    if (sampleCount === 0n || delta === 0n) return false;
    samples += sampleCount;
    ticks += sampleCount * delta;
    if (ticks > timescale * MAX_SECONDS) return false;
  }
  return samples > 0n && samples === BigInt(view.getUint32(stsz.body + 8));
}

export function isShortMp4Preview(bytes: Uint8Array) {
  if (bytes.byteLength < 32) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(view, 0, bytes.byteLength);
  if (!top || top.some((box) => box.type === "moof") || !top.some((box) => box.type === "ftyp") || !top.some((box) => box.type === "mdat")) return false;
  const moov = top.find((box) => box.type === "moov");
  if (!moov || moov.end - moov.start > MAX_MOOV_BYTES) return false;
  const moovChildren = boxes(view, moov.body, moov.end);
  const mvhd = moovChildren?.find((box) => box.type === "mvhd");
  const tracks = moovChildren?.filter((box) => box.type === "trak") ?? [];
  if (!mvhd || !duration(view, mvhd) || tracks.length < 1 || tracks.length > 8 || moovChildren?.some((box) => box.type === "mvex")) return false;
  let videoTrack = false;
  for (const track of tracks) {
    const mdia = child(view, track, "mdia");
    if (!mdia) return false;
    const mdhd = child(view, mdia, "mdhd");
    const hdlr = child(view, mdia, "hdlr");
    const minf = child(view, mdia, "minf");
    const stbl = minf && child(view, minf, "stbl");
    const stts = stbl && child(view, stbl, "stts");
    const stsz = stbl && (child(view, stbl, "stsz") ?? child(view, stbl, "stz2"));
    if (!mdhd || !hdlr || hdlr.end - hdlr.body < 12 || !stts || !stsz) return false;
    const timescale = duration(view, mdhd);
    if (!timescale || !sampleDuration(view, stts, stsz, timescale)) return false;
    const handler = String.fromCharCode(...new Uint8Array(bytes.buffer, bytes.byteOffset + hdlr.body + 8, 4));
    if (handler === "vide") videoTrack = true;
  }
  return videoTrack;
}
