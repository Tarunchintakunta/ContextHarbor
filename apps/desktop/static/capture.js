// Hidden window: meeting (system loopback) audio as "remote" and microphone as "me". Audio only; screen video is never used.
let ctx = null;
const streams = [];

async function tap(stream, channel) {
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm");
  node.port.onmessage = (e) => window.capture.frame(channel, e.data);
  src.connect(node);
}

async function start() {
  if (ctx) return;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule("pcm-worklet.js");
    const sys = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    sys.getVideoTracks().forEach((t) => { t.stop(); sys.removeTrack(t); }); // drop screen video immediately
    if (!sys.getAudioTracks().length) throw new Error("no system audio track");
    streams.push(sys);
    await tap(sys, "remote");
    window.capture.status("loopback ok");
  } catch (e) {
    window.capture.status(`error loopback: ${e && e.name}`);
  }
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    streams.push(mic);
    await tap(mic, "me");
    window.capture.status("mic ok");
  } catch (e) {
    window.capture.status(`mic unavailable: ${e && e.name}`);
  }
}

function stop() {
  streams.splice(0).forEach((s) => s.getTracks().forEach((t) => t.stop())); // releases devices
  if (ctx) { ctx.close(); ctx = null; }
  window.capture.status("stopped");
}

window.capture.on((m) => (m.cmd === "start" ? start() : stop()));
