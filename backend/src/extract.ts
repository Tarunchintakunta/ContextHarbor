// Document validation and text extraction. Parsing runs in a worker thread with memory and time limits,
// no network use, and no macro execution (mammoth only reads document XML; macro-enabled files are rejected).
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

export type Format = "md" | "pdf" | "docx";

export interface Extracted {
  state: "ready" | "needs_review" | "failed";
  text: string; // with locators: "[page 3]" markers for PDF, headings kept for MD/DOCX
  pages: number | null;
  warnings: string[];
  reason?: string; // for failed
}

export const LIMITS = { fileBytes: 25 * 1024 * 1024, filesPerWorkspace: 20, workspaceBytes: 500 * 1024 * 1024, pdfPages: 200 };

/** Checks the real file type from its bytes, not just the extension. */
export function sniff(name: string, buf: Buffer): { format: Format } | { error: string } {
  const ext = name.toLowerCase().match(/\.(md|markdown|pdf|docx)$/)?.[1];
  if (!ext) return { error: "Only .md, .pdf and .docx files are supported." };
  if (ext === "pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-" ? { format: "pdf" } : { error: "This file has a .pdf name but isn't a PDF." };
  if (ext === "docx") {
    if (buf.readUInt32LE(0) !== 0x04034b50) return { error: "This file has a .docx name but isn't a Word document." };
    const head = buf.toString("latin1");
    if (!head.includes("word/document.xml")) return { error: "This file has a .docx name but isn't a Word document." };
    if (head.includes("vbaProject.bin")) return { error: "Macro-enabled Word files aren't accepted. Save it as a regular .docx." };
    return { format: "docx" };
  }
  if (buf.includes(0)) return { error: "This file has a .md name but contains binary data." };
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { error: "Markdown files must be UTF-8 text." };
  }
  return { format: "md" };
}

/** Runs the parser in a constrained worker; a hung or memory-hungry file fails instead of hurting the server. */
export function extract(format: Format, buf: Buffer, timeoutMs = 30_000): Promise<Extracted> {
  return new Promise((resolve) => {
    const w = new Worker(fileURLToPath(new URL("./extract-worker.js", import.meta.url)), {
      workerData: { format, buf },
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64 },
    });
    const fail = (reason: string) => resolve({ state: "failed", text: "", pages: null, warnings: [], reason });
    const timer = setTimeout(() => {
      void w.terminate();
      fail("Reading this file took too long. It may be damaged or unusually complex.");
    }, timeoutMs);
    w.once("message", (m: Extracted) => {
      clearTimeout(timer);
      resolve(m);
      void w.terminate();
    });
    w.once("error", (e) => {
      clearTimeout(timer);
      fail(/memory/i.test(String(e)) ? "This file needs too much memory to read." : "This file couldn't be read. It may be damaged.");
    });
  });
}
