// ISO-week folder naming (`YYYY/Www_start_to_end/`) and time-hint parsing for retrieval.

export interface WeekInfo {
  year: number; // ISO week-numbering year
  week: number;
  start: string; // Monday, YYYY-MM-DD
  end: string; // Sunday, YYYY-MM-DD
  key: string; // "2026-W40"
  folder: string; // "2026/W40_2026-09-28_to_2026-10-04"
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function weekOf(date: Date | string): WeekInfo {
  const d = utc(typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(d.getTime() - dow * DAY);
  const thursday = new Date(monday.getTime() + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY);
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * DAY)) + 1;
  const ww = String(week).padStart(2, "0");
  const start = iso(monday);
  const end = iso(new Date(monday.getTime() + 6 * DAY));
  return { year, week, start, end, key: `${year}-W${ww}`, folder: `${year}/W${ww}_${start}_to_${end}` };
}

export interface PathMeta {
  week: string | null; // "2026-W40" or null for _reference
  date: string | null;
  docType: "reference" | "meeting" | "note";
}

// Derives week/date/doc_type from a path relative to the knowledge-base root.
export function parseKbPath(relPath: string): PathMeta {
  const p = relPath.replace(/\\/g, "/");
  if (p.startsWith("_reference/") || p.includes("/_reference/")) return { week: null, date: dateIn(p), docType: "reference" };
  const m = p.match(/(?:^|\/)(\d{4})\/W(\d{2})_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\//);
  const docType = p.includes("/meetings/") ? "meeting" : "note";
  if (!m) {
    const date = dateIn(p);
    return { week: date ? weekOf(date).key : null, date, docType };
  }
  return { week: `${m[1]}-W${m[2]}`, date: dateIn(p.slice(m.index! + m[0].length)) ?? m[3], docType };
}

function dateIn(s: string): string | null {
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// Returns the ISO-week keys a question refers to, or null when it carries no time hint.
export function timeHintWeeks(text: string, now: Date = new Date()): string[] | null {
  const t = text.toLowerCase();
  const thisWeek = weekOf(now);
  const shift = (days: number) => weekOf(new Date(utc(now).getTime() + days * DAY)).key;

  const date = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) return [weekOf(date[1]).key];
  if (/\blast week\b|\bprevious week\b/.test(t)) return [shift(-7)];
  if (/\bthis week\b/.test(t)) return [thisWeek.key];
  // ponytail: "sprint" assumed to be two weeks; make configurable if teams differ.
  if (/\b(this|current) sprint\b/.test(t)) return [shift(-7), thisWeek.key];
  if (/\blast sprint\b/.test(t)) return [shift(-21), shift(-14)];
  if (/\byesterday\b/.test(t)) return [shift(-1)];
  if (/\btoday\b/.test(t)) return [thisWeek.key];
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b(on |last )?${d}\\b`).test(t));
  if (wd >= 0) {
    const todayDow = (utc(now).getUTCDay() + 6) % 7;
    const back = (todayDow - wd + 7) % 7 || 7; // most recent past occurrence
    return [shift(-back)];
  }
  const mi = MONTHS.findIndex((m) => new RegExp(`\\b(in |during )?${m}\\b`).test(t));
  if (mi >= 0) {
    let year = utc(now).getUTCFullYear();
    if (mi > utc(now).getUTCMonth()) year -= 1; // "in November" asked in October means last year
    const keys = new Set<string>();
    for (let d = Date.UTC(year, mi, 1); new Date(d).getUTCMonth() === mi; d += DAY) keys.add(weekOf(new Date(d)).key);
    return [...keys];
  }
  return null;
}
