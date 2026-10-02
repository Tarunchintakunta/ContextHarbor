import ApiStatus from "./status";

const steps = [
  ["Detects the meeting", "Teams, Google Meet, Zoom, Webex or Slack: found from the app process and window title. Otherwise it stays idle."],
  ["Keeps live context", "Meeting audio is transcribed on your machine. Speech, chat and shared-screen text go into a rolling context window."],
  ["Finds your facts", "When someone asks you a question, it searches only your own notes, organised by week, and keeps the 3–6 best passages."],
  ["Shows a private answer", "1–3 bullets with sources appear in a small panel kept off shared screens where the OS allows. Nothing is typed into the meeting."],
];

const platforms: [string, string, string, string][] = [
  ["Windows 10 2004+ / 11", "Excluded from capture (WDA_EXCLUDEFROMCAPTURE)", "ok", "Not yet verified with a second device"],
  ["macOS", "Best effort: newer screen-sharing APIs can still capture it", "warn", "Panel moves to a secondary display while you present, or is hidden"],
  ["Linux", "No standard exclusion", "bad", "Panel hidden while you present on a single display"],
];

export default function Home() {
  return (
    <div className="wrap">
      <header className="top">
        <span className="brand">ContextHarbor</span>
        <ApiStatus />
      </header>

      <section className="hero">
        <h1>Your notes, ready when the question comes.</h1>
        <p>
          A private desktop assistant for your meetings. It listens on your own computer and answers questions aimed at you, using only
          your own knowledge base. The short answer is shown to you alone.
        </p>
      </section>

      <div className="grid">
        {steps.map(([t, d], i) => (
          <div className="card" key={t}>
            <div className="step">Step {i + 1}</div>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </div>

      <h2>Private by design</h2>
      <div className="grid">
        <div className="card"><h3>One user, one knowledge base</h3><p>Every search is filtered to the signed-in user. Switching users clears all context first.</p></div>
        <div className="card"><h3>Local and encrypted</h3><p>Transcripts, summaries and history are encrypted on your machine. Raw audio and screen frames are never stored.</p></div>
        <div className="card"><h3>Consent first</h3><p>Nothing is recorded until your organisation policy and consent are set. Exams and interviews are excluded.</p></div>
        <div className="card"><h3>Any model</h3><p>Use a local model (Ollama, llama.cpp) or a hosted API. The model is pinned and has an automatic fallback.</p></div>
      </div>

      <h2>Screen-sharing support</h2>
      <p className="note">We don&apos;t promise invisibility. Each platform below shows what is tested and what the app does instead.</p>
      <div className="scroll">
        <table>
          <thead><tr><th>Platform</th><th>Capture exclusion</th><th>When you present</th></tr></thead>
          <tbody>
            {platforms.map(([p, e, level, f]) => (
              <tr key={p}><td>{p}</td><td><span className={`tag ${level}`}>{level === "ok" ? "supported" : level === "warn" ? "best effort" : "unsupported"}</span> {e}</td><td>{f}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer>
        Desktop app in development. Source: <a href="https://github.com/Tarunchintakunta/ContextHarbor">github.com/Tarunchintakunta/ContextHarbor</a>
      </footer>
    </div>
  );
}
