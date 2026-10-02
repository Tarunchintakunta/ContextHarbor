#!/usr/bin/env bash
# End-to-end demo: simulated meeting audio -> whisper STT -> question detection -> RAG -> local LLM -> private overlay.
# Uses an isolated profile and synthetic, nonconfidential notes. Audio comes from a generated WAV (labeled "simulated audio").
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-../../evidence/demo}
WORK=$(mktemp -d)
mkdir -p "$OUT"
say -v Samantha -o "$WORK/a.aiff" "Okay, next up is payments. [[slnc 1200]] Varish, when does the payments migration launch?"
ffmpeg -loglevel error -y -i "$WORK/a.aiff" -ar 16000 -ac 1 -c:a pcm_s16le "$WORK/a.wav"
mkdir -p "$WORK/userdata"
node -e '
const fs=require("fs"),path=require("path");
const cfg=JSON.parse(fs.readFileSync("config/models.json","utf8"));
const s={userId:"demo-varish",users:["demo-varish"],profile:{names:["Varish"],roles:["backend team"],ownedTopics:["payments migration"]},
 knowledgeBaseDir:path.resolve("demo/kb"),policy:{organization:"allowed",consentConfirmed:true,allPartyConsent:false,blockedTitlePattern:"exam|assessment|interview"},
 retention:{transcriptDays:30,answerHistoryDays:30},display:{mode:"auto",trustCaptureExclusion:false},autoHideSeconds:25,startAtLogin:false,
 hotkeys:{pause:"CommandOrControl+Alt+P",ask:"CommandOrControl+Alt+A",toggle:"CommandOrControl+Alt+H",pin:"CommandOrControl+Alt+K",dismiss:"CommandOrControl+Alt+D"},
 models:cfg.chain,embedding:cfg.embedding,stt:cfg.stt};
fs.writeFileSync(process.argv[1]+"/settings.json",JSON.stringify(s,null,2));' "$WORK/userdata"
pnpm -s build
CH_USER_DATA="$WORK/userdata" CH_DEMO_MEETING="Sprint sync" CH_DEMO_AUDIO="$WORK/a.wav" CH_E2E=1 CH_E2E_OUT="$OUT/demo-run" \
  perl -e 'alarm 180; exec @ARGV' ./node_modules/.bin/electron . 2>"$OUT/demo-run.stderr.log" || true
rm -rf "$WORK"
cat "$OUT/demo-run.json"
