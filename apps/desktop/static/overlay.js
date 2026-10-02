const $ = (id) => document.getElementById(id);
$("pause").onclick = () => window.harbor.command("toggle-pause");
$("hide").onclick = () => window.harbor.command("toggle-visible");
$("quit").onclick = () => window.harbor.command("quit");
window.harbor.onState((s) => {
  $("marker").textContent = s.marker;
  $("status").textContent = `${s.paused ? "Paused" : "Active"} · capture: ${s.capture} · protection: ${s.contentProtection}`;
  $("pause").textContent = s.paused ? "Resume" : "Pause";
});
