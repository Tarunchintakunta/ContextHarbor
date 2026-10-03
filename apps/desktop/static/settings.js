const $ = (id) => document.getElementById(id);
const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
let data;

function el(tag, text, cls) { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }

async function load() {
  data = await window.api.get();
  const s = data.settings;
  $("user").replaceChildren(...s.users.map((u) => { const o = el("option", u); o.value = u; o.selected = u === s.userId; return o; }));
  $("names").value = s.profile.names.join(", "); $("roles").value = s.profile.roles.join(", "); $("topics").value = s.profile.ownedTopics.join(", ");
  $("kbDir").value = s.knowledgeBaseDir; $("weekEx").textContent = `${data.week}/`;
  $("kbStats").textContent = `${data.kbChunks} indexed chunks · embeddings: ${data.embedder}`;
  $("org").value = s.policy.organization; $("consent").checked = s.policy.consentConfirmed; $("allParty").checked = s.policy.allPartyConsent; $("blocked").value = s.policy.blockedTitlePattern;
  $("tDays").value = s.retention.transcriptDays; $("hDays").value = s.retention.answerHistoryDays;
  for (const k of ["pause", "ask", "toggle", "pin", "dismiss"]) $(`hk-${k}`).value = s.hotkeys[k];
  $("autoHide").value = s.autoHideSeconds;
  $("dispMode").value = s.display.mode; $("trust").checked = s.display.trustCaptureExclusion;
  $("dispId").replaceChildren(...data.displays.map((d) => { const o = el("option", d.label); o.value = d.id; o.selected = d.id === s.display.displayId; return o; }));
  $("protNote").textContent = data.platform === "win32" ? "Windows: the panel is excluded from capture on Windows 10 2004+ (verify with a second device)."
    : data.platform === "darwin" ? "macOS: capture exclusion is best effort; modern screen sharing can still include the panel. Prefer a second display or share a single window."
    : "Linux: no standard capture exclusion; the panel is hidden while you present on a single display.";
  $("models").textContent = `Pinned chain: ${s.models.map((m) => `${m.model} (${m.provider})`).join(" → ")} → "Answer unavailable"`;
  await lists();
}

async function lists() {
  const ms = await window.api.meetings();
  $("meetings").replaceChildren(...(ms.length ? ms.map((m) => {
    const row = el("div", "", "item");
    row.append(el("span", `${new Date(m.startedAt).toLocaleString()} — ${m.title}`));
    const v = el("button", "Review"); v.onclick = async () => { $("viewer").hidden = false; $("viewer").textContent = await window.api.meeting(m.id); };
    const x = el("button", "Export"); x.onclick = () => window.api.exportMeeting(m.id);
    const d = el("button", "Delete", "danger"); d.onclick = async () => { await window.api.deleteMeeting(m.id); $("viewer").hidden = true; lists(); };
    row.append(v, x, d); return row;
  }) : [el("p", "No saved meetings.", "muted")]));
  const h = await window.api.history();
  $("history").replaceChildren(...(h.length ? h.slice(0, 50).map((e) => { const r = el("div", "", "item"); r.append(el("span", `${new Date(e.t).toLocaleString()} — Q: ${e.question}\n${e.answer}`)); return r; }) : [el("p", "No answers yet.", "muted")]));
}

$("save").onclick = async () => {
  const hotkeys = {}; for (const k of ["pause", "ask", "toggle", "pin", "dismiss"]) hotkeys[k] = $(`hk-${k}`).value.trim();
  await window.api.patch({
    profile: { names: csv($("names").value), roles: csv($("roles").value), ownedTopics: csv($("topics").value) },
    knowledgeBaseDir: $("kbDir").value.trim() !== data.settings.knowledgeBaseDir ? $("kbDir").value.trim() : undefined,
    policy: { organization: $("org").value, consentConfirmed: $("consent").checked, allPartyConsent: $("allParty").checked, blockedTitlePattern: $("blocked").value },
    retention: { transcriptDays: Number($("tDays").value), answerHistoryDays: Number($("hDays").value) },
    hotkeys, autoHideSeconds: Number($("autoHide").value),
    display: { mode: $("dispMode").value, displayId: Number($("dispId").value), trustCaptureExclusion: $("trust").checked },
  });
  $("saved").textContent = "Saved"; setTimeout(() => ($("saved").textContent = ""), 2000);
  load();
};
$("user").onchange = async () => { await window.api.switchUser($("user").value); load(); };
$("addUser").onclick = async () => { const id = $("newUser").value.trim(); if (id) { await window.api.switchUser(id); $("newUser").value = ""; load(); } };
$("openKb").onclick = () => window.api.openKb();
$("saveKey").onclick = async () => { await window.api.setApiKey($("keyRef").value.trim(), $("keyVal").value); $("keyVal").value = ""; $("saved").textContent = "Key saved to keychain"; };
$("wipe").onclick = async () => { if (await window.api.wipe()) load(); };
function webRender(w) {
  const t = w.lastSync ? new Date(w.lastSync).toLocaleTimeString() : "";
  $("webStatus").textContent = w.connected
    ? `Connected as ${w.email} (${w.workspace}). ${w.documents} document${w.documents === 1 ? "" : "s"} synced${t ? ` at ${t}` : ""}.${w.error ? ` ${w.error}` : ""}`
    : w.error ? `Not connected. ${w.error}` : "Not connected.";
  $("webConnect").hidden = w.connected;
  $("webSync").hidden = !w.connected;
  $("webDisconnect").hidden = !w.connected;
}
$("webConnect").onclick = async () => { $("webStatus").textContent = "Finish signing in in your browser…"; webRender(await window.api.webConnect()); load(); };
$("webSync").onclick = async () => { $("webStatus").textContent = "Syncing…"; webRender(await window.api.webSync()); load(); };
$("webDisconnect").onclick = async () => { webRender(await window.api.webDisconnect()); load(); };
window.api.web().then(webRender);
load();
