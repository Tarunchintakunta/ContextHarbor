// Streaming-ish speech-to-text: energy VAD segments 16 kHz mono PCM per channel, whisper.cpp transcribes each segment.
// Raw audio lives only in memory and in a short-lived temp WAV that is deleted right after transcription.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

export const RATE = 16_000;

export interface Segment {
  channel: "remote" | "me";
  startedAt: number; // epoch ms
  pcm: Int16Array;
}

/** Splits a PCM stream into utterances: ends after `silenceMs` of quiet or at `maxMs`. */
export class VadSegmenter {
  private buf: Int16Array[] = [];
  private bufLen = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private startedAt = 0;

  constructor(
    readonly channel: "remote" | "me",
    private onSegment: (s: Segment) => void,
    private opts = { threshold: 0.012, silenceMs: 700, maxMs: 12_000, minSpeechMs: 400 },
  ) {}

  push(frame: Int16Array, now = Date.now()) {
    const ms = (frame.length / RATE) * 1000;
    const speaking = rms(frame) > this.opts.threshold;
    if (!this.bufLen && !speaking) return; // idle: nothing buffered, nothing kept
    if (!this.bufLen) this.startedAt = now - ms;
    this.buf.push(frame);
    this.bufLen += frame.length;
    if (speaking) {
      this.speechMs += ms;
      this.silenceMs = 0;
    } else this.silenceMs += ms;
    const total = (this.bufLen / RATE) * 1000;
    if (this.silenceMs >= this.opts.silenceMs || total >= this.opts.maxMs) this.flush();
  }

  flush() {
    if (this.bufLen && this.speechMs >= this.opts.minSpeechMs) {
      const pcm = new Int16Array(this.bufLen);
      let o = 0;
      for (const b of this.buf) {
        pcm.set(b, o);
        o += b.length;
      }
      this.onSegment({ channel: this.channel, startedAt: this.startedAt, pcm });
    }
    this.buf = [];
    this.bufLen = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
  }
}

export function rms(f: Int16Array) {
  let s = 0;
  for (const x of f) s += x * x;
  return Math.sqrt(s / Math.max(1, f.length)) / 32768;
}

export function wav(pcm: Int16Array) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.byteLength, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

export class WhisperCli {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private dir = mkdtempSync(path.join(tmpdir(), "ch-stt-"));

  /** `vocabulary`: names, roles and topics passed as whisper's initial prompt so they transcribe correctly. */
  constructor(private binary: string, private modelPath: string, public vocabulary = "", private maxQueue = 3) {}

  /** Verifies the pinned model file before first use. */
  static async verify(modelPath: string, sha256: string) {
    const h = createHash("sha256");
    await new Promise<void>((res, rej) => createReadStream(modelPath).on("data", (d) => h.update(d)).on("end", () => res()).on("error", rej));
    if (h.digest("hex") !== sha256) throw new Error("STT model checksum mismatch");
  }

  /** Transcribes one segment. Drops (returns null) when the queue is full so audio never backs up. */
  transcribe(seg: Segment): Promise<string | null> {
    if (this.pending >= this.maxQueue) return Promise.resolve(null);
    this.pending++;
    const run = async () => {
      const file = path.join(this.dir, `${seg.channel}-${seg.startedAt}.wav`);
      writeFileSync(file, wav(seg.pcm));
      try {
        const out = await new Promise<string>((res, rej) =>
          execFile(this.binary, ["-m", this.modelPath, "-f", file, "-l", "en", "-nt", "-np", "-t", "4", ...(this.vocabulary ? ["--prompt", this.vocabulary.slice(0, 200)] : [])], { timeout: 20_000 }, (e, so) => (e ? rej(e) : res(so))),
        );
        return clean(out);
      } finally {
        rmSync(file, { force: true }); // no raw audio kept
        this.pending--;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  dispose() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

function clean(s: string) {
  const t = s.replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]|\((?:music|silence|inaudible)[^)]*\)/gi, " ").replace(/\s+/g, " ").trim();
  return t.length < 2 ? "" : t;
}
