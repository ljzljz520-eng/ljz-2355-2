#!/usr/bin/env bash
# Deterministic partial-upload acceptance.
# Scenario A: ALL preview uploads fail  -> page has zero example iframes but
#             contract/report/install artifacts still land; site stays healthy.
# Scenario B: exactly one preview fails  -> sibling examples still publish.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV=$(mktemp -d); PORT=4183; PPORT=4184
cleanup(){ kill $PID 2>/dev/null || true; rm -rf "$ENV"; }
trap cleanup EXIT

start(){
  cd "$ENV"
  ARTIFACT_FAIL_KINDS="$1" ARTIFACT_FAIL_NAME="$2" DOC_ADMIN_PASSWORD=secret \
    python3 "$ROOT/server/server.py" --db docs.db --storage store --site "$ROOT/dist-partial" \
    --port $PORT --preview-port $PPORT >srv.log 2>&1 &
  PID=$!; cd "$ROOT"; sleep 1.3
  TOKEN=$(curl -s -X POST http://127.0.0.1:$PORT/api/admin/login -H 'Content-Type: application/json' -d '{"password":"secret"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
  node tools/build.mjs --component Button --version 2.0.0 --commit v2.0.0 --branch B \
    --server http://127.0.0.1:$PORT --token "$TOKEN" >build.log 2>&1
  curl -s -X POST http://127.0.0.1:$PORT/api/admin/releases -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"component":"Button","version":"2.0.0","retestResults":{"button.type->variant":true,"button.label-slot":true}}' >/dev/null
  node tools/sitegen.mjs http://127.0.0.1:$PORT/api/site-data "$ROOT/dist-partial" http://127.0.0.1:$PPORT >/dev/null
}

echo "== Scenario A: every preview upload fails =="
start "preview" ""
python3 - "$ROOT" <<'PY'
import json,sys,pathlib
root=pathlib.Path(sys.argv[1])
d=json.load(open(root/'dist-partial/assets/site-data.json'))
v=d['components']['Button']['versions'][0]
assert v['examples']==[], v['examples']
blocked={(b['example']):(b['status'],b['uploaded']) for b in v['blockedExamples']}
assert blocked['basic.js']==('pass',0), blocked      # passed gate but upload missing
assert blocked['rename-variant.js']==('pass',0)
html=(root/'dist-partial/components/Button/2.0.0/index.html').read_text()
assert '<iframe' not in html
assert '没有通过门控并完成上传的示例' in html
print('  A ok: zero iframes, blocked listed as upload-missing, page intact')
PY
kill $PID 2>/dev/null || true; sleep 0.5; rm -rf "$ENV"; mkdir -p "$ENV"

echo "== Scenario B: only basic.js preview upload fails =="
start "" "basic.js"
python3 - "$ROOT" <<'PY'
import json,sys,pathlib
root=pathlib.Path(sys.argv[1])
d=json.load(open(root/'dist-partial/assets/site-data.json'))
v=d['components']['Button']['versions'][0]
names=[e['name'] for e in v['examples']]
assert names==['rename-variant.js'], names
blocked={b['example']:(b['status'],b['uploaded']) for b in v['blockedExamples']}
assert blocked['basic.js']==('pass',0)
html=(root/'dist-partial/components/Button/2.0.0/index.html').read_text()
assert html.count('<iframe')==1
print('  B ok: sibling example still embedded; failed upload excluded only itself')
PY
echo "PARTIAL-UPLOAD ACCEPTANCE OK"
