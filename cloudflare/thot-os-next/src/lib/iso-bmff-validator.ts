/**
 * Streaming ISO-BMFF envelope validation used for native source intake.
 * Codec markers are considered only inside the top-level `moov` metadata box,
 * never arbitrary media payload, so an `mdat` byte sequence cannot masquerade
 * as a supported codec.
 */
export function isoBmffBoxHeader(input: Uint8Array) {
  if (input.length < 8) return null;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const size32 = view.getUint32(0);
  const headerBytes = size32 === 1 ? 16 : 8;
  if (input.length < headerBytes) return null;
  const type = String.fromCharCode(...input.subarray(4, 8));
  if (!/^[\x20-\x7e]{4}$/.test(type)) throw new Error("source_media_container_invalid");
  const size = size32 === 1 ? Number(view.getBigUint64(8)) : size32;
  if (!Number.isSafeInteger(size) || size < headerBytes) throw new Error("source_media_container_invalid");
  return { headerBytes, size, type };
}

export class IsoBmffValidator {
  private readonly mime: string;
  private pending = new Uint8Array();
  private payloadRemaining = 0;
  private boxCount = 0;
  private firstBox = true;
  private sawFtyp = false;
  private sawMoov = false;
  private sawMeta = false;
  private sawMdat = false;
  private fourccTail = new Uint8Array();
  private codec: "h264" | "h265" | null = null;
  private codecPayloadRemaining = 0;

  constructor(mime: string) { this.mime = mime; }

  private observeCodec(input: Uint8Array) {
    const bytes = new Uint8Array(this.fourccTail.length + input.length);
    bytes.set(this.fourccTail); bytes.set(input, this.fourccTail.length);
    for (let index = 0; index + 4 <= bytes.length; index += 1) {
      const a = bytes[index]; const b = bytes[index + 1]; const c = bytes[index + 2]; const d = bytes[index + 3];
      if (a === 0x68 && b === 0x76 && c === 0x63 && (d === 0x31 || d === 0x65)) this.codec = "h265"; // hvc1 / hev1
      if (a === 0x61 && b === 0x76 && c === 0x63 && d === 0x31 && !this.codec) this.codec = "h264"; // avc1
    }
    this.fourccTail = bytes.slice(Math.max(0, bytes.length - 3));
  }

  push(input: Uint8Array) {
    let offset = 0;
    while (offset < input.length) {
      if (this.payloadRemaining > 0) {
        const skipped = Math.min(this.payloadRemaining, input.length - offset);
        if (this.codecPayloadRemaining > 0) {
          const codecBytes = Math.min(this.codecPayloadRemaining, skipped);
          this.observeCodec(input.subarray(offset, offset + codecBytes));
          this.codecPayloadRemaining -= codecBytes;
        }
        this.payloadRemaining -= skipped;
        offset += skipped;
        continue;
      }
      const needed = 16 - this.pending.length;
      const take = Math.min(needed, input.length - offset);
      const next = new Uint8Array(this.pending.length + take);
      next.set(this.pending); next.set(input.subarray(offset, offset + take), this.pending.length);
      this.pending = next; offset += take;
      const header = isoBmffBoxHeader(this.pending);
      if (!header) continue;
      const { headerBytes, size, type } = header;
      if (this.firstBox && type !== "ftyp") throw new Error("source_media_container_invalid");
      this.firstBox = false;
      this.boxCount += 1;
      if (this.boxCount > 100_000) throw new Error("source_media_container_invalid");
      if (type === "ftyp") this.sawFtyp = true;
      if (type === "moov") {
        if (size > 256 * 1024 * 1024) throw new Error("source_media_metadata_too_large");
        this.sawMoov = true;
      }
      if (type === "meta") { if (size > 256 * 1024 * 1024) throw new Error("source_media_metadata_too_large"); this.sawMeta = true; }
      if (type === "mdat") this.sawMdat = true;
      this.payloadRemaining = size - headerBytes;
      this.codecPayloadRemaining = type === "moov" && this.mime.startsWith("video/") ? this.payloadRemaining : 0;
      const remainder = this.pending.subarray(headerBytes);
      this.pending = new Uint8Array();
      if (remainder.length) this.push(remainder);
    }
  }

  skipPayload(byteCount: number) {
    if (!Number.isSafeInteger(byteCount) || byteCount < 0 || this.pending.length || this.codecPayloadRemaining || byteCount > this.payloadRemaining) throw new Error("source_media_container_invalid");
    this.payloadRemaining -= byteCount;
  }

  finish() {
    if (this.pending.length || this.payloadRemaining || !this.sawFtyp || !this.sawMdat || (this.mime.startsWith("video/") ? !this.sawMoov : !this.sawMeta)) throw new Error("source_media_container_invalid");
    if (this.mime.startsWith("video/") && !this.codec) throw new Error("source_media_video_codec_unsupported");
    return this.codec;
  }
}
