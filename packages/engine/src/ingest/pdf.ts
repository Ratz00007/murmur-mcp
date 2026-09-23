/**
 * Best-effort PDF text extraction (no dependencies, node:zlib only).
 *
 * Handles text-layer PDFs with FlateDecode/uncompressed content streams and
 * standard string-showing operators (Tj, TJ, ', "). Font-remapped or
 * scanned-image PDFs yield little text — callers detect that and fall back to
 * asking the host agent to read the PDF and pass text via seed_add_text
 * (the Host-Powered Inference pattern: the host has eyes, the engine has state).
 */
import * as zlib from "node:zlib";

const MAX_CHARS = 2_000_000;
/** Hard cap for a single inflate call — decompression-bomb guard. */
const MAX_STREAM_BYTES = 32 * 1024 * 1024;

export function extractPdfText(buf: Buffer): { text: string; ok: boolean } {
  const streams = decodeStreamSegments(buf);
  const parts: string[] = [];
  for (const s of streams) {
    if (!looksLikeContentStream(s)) continue;
    parts.push(extractTextOps(s));
  }
  let text = parts.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  return { text, ok: text.replace(/\s/g, "").length >= 40 };
}

/** Extract inflate-able / raw `stream … endstream` payloads. */
function decodeStreamSegments(buf: Buffer): string[] {
  const latin = buf.toString("latin1");
  const out: string[] = [];
  let totalOut = 0;
  let idx = 0;
  while (out.length < 5000) {
    const s = latin.indexOf("stream", idx);
    if (s === -1) break;
    // skip the "stream" inside "endstream"
    if (latin.slice(s - 3, s) === "end") {
      idx = s + 6;
      continue;
    }
    let start = s + 6;
    if (latin[start] === "\r") start++;
    if (latin[start] === "\n") start++;
    const e = latin.indexOf("endstream", start);
    if (e === -1) break;
    const chunk = buf.subarray(start, e);
    let text: string;
    try {
      text = zlib.inflateSync(chunk, { maxOutputLength: MAX_STREAM_BYTES }).toString("latin1");
    } catch (err) {
      if (isOutputTooLarge(err)) throw inflateCapError();
      try {
        text = zlib.inflateRawSync(chunk, { maxOutputLength: MAX_STREAM_BYTES }).toString("latin1");
      } catch (err2) {
        if (isOutputTooLarge(err2)) throw inflateCapError();
        text = chunk.toString("latin1");
      }
    }
    // Enforce the documented output cap DURING inflation: cumulative inflated
    // bytes must never exceed MAX_CHARS — a decompression bomb fails fast
    // here, stream by stream, not after joining everything.
    totalOut += text.length;
    if (totalOut > MAX_CHARS) {
      throw new Error(
        `PDF decompression aborted: cumulative inflated output exceeds the ${MAX_CHARS}-char output cap (possible decompression bomb)`,
      );
    }
    out.push(text);
    idx = e + 9;
  }
  return out;
}

/** Node reports ERR_BUFFER_TOO_LARGE when `maxOutputLength` is hit. */
function isOutputTooLarge(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE";
}

function inflateCapError(): Error {
  return new Error(
    `PDF decompression aborted: single stream exceeds the ${MAX_STREAM_BYTES}-byte inflate cap (possible decompression bomb)`,
  );
}

function looksLikeContentStream(s: string): boolean {
  return /\bTj\b|\bTJ\b|\bBT\b/.test(s);
}

/** Pull text out of a content stream, preserving order across operators. */
function extractTextOps(content: string): string {
  // Text-positioning operators approximate line breaks.
  const marked = content.replace(/\b(BT|ET|T\*|Td|TD|TL)\b/g, "\n");
  const re =
    /\[((?:\\.|[^\]\\])*)\]\s*TJ|\(((?:\\.|[^()\\])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*(?:Tj|TJ)|(\n)/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(marked)) !== null) {
    if (m[4] !== undefined) {
      out += "\n";
    } else if (m[1] !== undefined) {
      out += parsePdfStrings(m[1]).join("");
    } else if (m[2] !== undefined) {
      out += unescapePdfString(m[2]);
    } else if (m[3] !== undefined) {
      out += decodeHexMaybeUtf16(m[3]);
    }
  }
  return out.replace(/\n\s*\n/g, "\n").trim();
}

/** All literal strings inside a TJ array body. */
function parsePdfStrings(body: string): string[] {
  const re = /\(((?:\\.|[^()\\])*)\)|<([0-9A-Fa-f\s]+)>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push(m[1] !== undefined ? unescapePdfString(m[1]) : decodeHexMaybeUtf16(m[2]));
  }
  return out;
}

function unescapePdfString(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      const code = s.charCodeAt(i);
      bytes.push(code & 0xff);
      continue;
    }
    i++;
    const d = s[i];
    if (d === undefined) break;
    if (d === "n") bytes.push(10);
    else if (d === "r") bytes.push(13);
    else if (d === "t") bytes.push(9);
    else if (d === "b") bytes.push(8);
    else if (d === "f") bytes.push(12);
    else if (d === "(") bytes.push(40);
    else if (d === ")") bytes.push(41);
    else if (d === "\\") bytes.push(92);
    else if (d >= "0" && d <= "7") {
      let oct = d;
      while (oct.length < 3 && s[i + 1] >= "0" && s[i + 1] <= "7") oct += s[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (d === "\n") {
      // line continuation — emit nothing
    } else {
      bytes.push(d.charCodeAt(0) & 0xff);
    }
  }
  return bytesToText(bytes);
}

function decodeHexMaybeUtf16(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return bytesToText(bytes);
}

function bytesToText(bytes: number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE with BOM
    let s = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  return bytes.map((b) => String.fromCharCode(b)).join("");
}
