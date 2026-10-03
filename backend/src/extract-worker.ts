import { parentPort, workerData } from "node:worker_threads";
import type { Extracted, Format } from "./extract.js";

const { format, buf } = workerData as { format: Format; buf: Uint8Array };
const MAX_PAGES = 200;

async function run(): Promise<Extracted> {
  if (format === "md") {
    const text = Buffer.from(buf).toString("utf8").replace(/\r\n?/g, "\n");
    return text.trim() ? { state: "ready", text, pages: null, warnings: [] } : { state: "failed", text: "", pages: null, warnings: [], reason: "The file is empty." };
  }

  if (format === "pdf") {
    const { getDocumentProxy } = await import("unpdf");
    let pdf;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buf), { disableFontFace: true, useSystemFonts: false });
    } catch (e) {
      const msg = String((e as Error)?.name ?? e);
      return { state: "failed", text: "", pages: null, warnings: [], reason: /Password/i.test(msg) ? "This PDF is password-protected. Remove the password and upload it again." : "This PDF couldn't be read. It may be damaged." };
    }
    if (pdf.numPages > MAX_PAGES) return { state: "failed", text: "", pages: pdf.numPages, warnings: [], reason: `This PDF has ${pdf.numPages} pages; the limit is ${MAX_PAGES}.` };
    const parts: string[] = [];
    const empty: number[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const t = tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("").replace(/[ \t]+\n/g, "\n").trim();
      if (t.length < 20) empty.push(i);
      parts.push(`[page ${i}]\n${t}`);
    }
    const warnings = empty.length ? [`No readable text on page${empty.length > 1 ? "s" : ""} ${empty.slice(0, 20).join(", ")}${empty.length > 20 ? "…" : ""}. These may be scanned images; their content won't be used.`] : [];
    if (empty.length === pdf.numPages) return { state: "failed", text: "", pages: pdf.numPages, warnings, reason: "No text could be read. This looks like a scanned PDF; scanned documents aren't supported yet." };
    return { state: warnings.length ? "needs_review" : "ready", text: parts.join("\n\n"), pages: pdf.numPages, warnings };
  }

  // docx: headings become Markdown headings; tables become rows of cells. Images are not read.
  const mammoth = (await import("mammoth")).default;
  const r = await mammoth.convertToHtml({ buffer: Buffer.from(buf) }, { includeDefaultStyleMap: true, convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
  const html = r.value;
  const images = (html.match(/<img/g) ?? []).length;
  const flat = (c: string) => c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = html
    // Tables: one line per row, cells separated by " | " (cell paragraphs flattened).
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_m, row: string) => `${[...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => flat(c[1])).join(" | ")}\n`)
    .replace(/<h([1-6])[^>]*>/g, (_m, n) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/g, "\n")
    .replace(/<\/(p|li)>/g, "\n")
    .replace(/<li[^>]*>/g, "- ")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const warnings = images ? [`${images} image${images > 1 ? "s" : ""} or diagram${images > 1 ? "s" : ""} in this document can't be read; only the text is used.`] : [];
  if (!text) return { state: "failed", text: "", pages: null, warnings, reason: "No text could be read from this document." };
  return { state: warnings.length ? "needs_review" : "ready", text, pages: null, warnings };
}

run().then(
  (r) => parentPort!.postMessage(r),
  () => parentPort!.postMessage({ state: "failed", text: "", pages: null, warnings: [], reason: "This file couldn't be read. It may be damaged." } satisfies Extracted),
);
