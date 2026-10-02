const $ = (id) => document.getElementById(id);
let streaming = "";
function render(text, provisional) {
  const el = $("answer");
  el.textContent = "";
  el.classList.toggle("provisional", provisional);
  const lines = text.split("\n");
  const src = lines.findIndex((l) => /^—\s*sources?:/i.test(l));
  el.append(document.createTextNode((src >= 0 ? lines.slice(0, src) : lines).join("\n")));
  if (src >= 0) { const s = document.createElement("span"); s.className = "src"; s.textContent = lines.slice(src).join(" "); el.append(s); }
}
window.overlay.on((m) => {
  if (m.kind === "state") {
    $("dot").classList.toggle("on", m.listening && !m.paused);
    $("status").textContent = `${m.paused ? "Paused" : m.listening ? "Listening" : "Idle"}${m.simulated ? " · simulated audio" : ""}${m.user ? ` · ${m.user}` : ""}${m.status && m.status !== "idle" ? ` · ${m.status}` : ""}`;
    $("pin").hidden = !m.pinned;
  } else if (m.kind === "question") {
    streaming = ""; $("question").textContent = `Q: ${m.text}`; render("looking…", true); $("foot").textContent = "";
  } else if (m.kind === "status") {
    if (!streaming) render(m.text, true);
  } else if (m.kind === "delta") {
    streaming += m.text; render(streaming, true);
  } else if (m.kind === "final") {
    render(m.text, false); $("foot").textContent = m.model ? `${m.model} · ${(m.ms / 1000).toFixed(1)} s` : "";
  } else if (m.kind === "placement") {
    $("foot").dataset.protection = m.protection;
  } else if (m.kind === "clear") {
    streaming = ""; $("question").textContent = ""; render("", false); $("foot").textContent = "";
  }
});
