"use client";
import { useEffect, useState } from "react";

const DOCS = ["payments-plan-2026-09-30.md", "perf-review.pdf", "ledger-notes.docx"];

const MOMENTS = [
  {
    ask: "Launch date",
    who: "Priya, remote",
    heard: "When does the payments migration launch?",
    match: 0,
    answer: "October 14, starting with Ireland and the Netherlands.",
    source: "payments-plan-2026-09-30.md, 30 Sep",
  },
  {
    ask: "Checkout latency",
    who: "Marco, remote",
    heard: "What was checkout p95 latency last week?",
    match: 1,
    answer: "182 ms, measured on 1 October.",
    source: "perf-review.pdf, page 1",
  },
  {
    ask: "Contract owner",
    who: "Dana, remote",
    heard: "Who owns the vendor contract renewal?",
    match: -1,
    answer: "Not in your documents. Say you'll confirm and follow up.",
    source: "No source matched, so nothing is guessed.",
  },
];

// phase: 0 hearing, 1 searching, 2 found, 3 answer shown
const STEP_MS = [0, 900, 900, 4200];

export default function Showcase() {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState(0);
  const [chars, setChars] = useState(0);
  const [still, setStill] = useState(false);
  const m = MOMENTS[i];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setStill(true);
  }, []);

  useEffect(() => {
    if (still) return;
    if (phase === 0) {
      if (chars < m.heard.length) {
        const t = setTimeout(() => setChars((c) => c + 1), 28);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase(1), 350);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (phase < 3) setPhase(phase + 1);
      else pick((i + 1) % MOMENTS.length);
    }, STEP_MS[phase]);
    return () => clearTimeout(t);
  }, [phase, chars, still, i, m.heard.length]);

  function pick(n: number) {
    setI(n);
    setPhase(0);
    setChars(0);
  }

  const p = still ? 3 : phase;
  const typed = still ? m.heard : m.heard.slice(0, chars);

  return (
    <aside className="show" aria-label="How ContextHarbor answers a question in a meeting">
      <p className="show-title">What happens when someone asks you a question</p>

      <div className="show-asks" role="group" aria-label="Try a question">
        {MOMENTS.map((x, n) => (
          <button key={x.ask} type="button" className={n === i ? "on" : ""} aria-pressed={n === i} onClick={() => { setStill(false); pick(n); }}>
            {x.ask}
          </button>
        ))}
      </div>

      <ol className="flow">
        <li className={p >= 0 ? "lit" : ""}>
          <h3>Hears the question</h3>
          <p className="heard">
            <span className="who">{m.who}</span>
            <span>&ldquo;{typed}{p === 0 && <i className="caret" aria-hidden="true" />}{p > 0 && "”"}</span>
          </p>
        </li>

        <li className={p >= 1 ? "lit" : ""}>
          <h3>Checks only your documents</h3>
          <ul className={`docs-scan${p === 1 ? " scanning" : ""}`}>
            {DOCS.map((d, n) => (
              <li key={d} className={p >= 2 && n === m.match ? "hit" : p >= 2 ? "miss" : ""}>
                <span>{d}</span>
                {p >= 2 && n === m.match && <b>match</b>}
              </li>
            ))}
          </ul>
          {p >= 2 && <small className="timing">{m.match < 0 ? "No passage scored high enough" : "Found in 33 ms, on this computer"}</small>}
        </li>

        <li className={p >= 3 ? "lit" : ""}>
          <h3>Shows you the answer, privately</h3>
          <div className={`mini-cue${p >= 3 ? " in" : ""}${m.match < 0 ? " abstain" : ""}`} aria-live="polite">
            {p >= 3 ? (
              <>
                <strong>{m.answer}</strong>
                <small>{m.source}</small>
              </>
            ) : (
              <span className="wait">Waiting for the question…</span>
            )}
          </div>
        </li>
      </ol>
    </aside>
  );
}
