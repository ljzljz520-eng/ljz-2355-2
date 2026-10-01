#!/usr/bin/env bash
# Full clean end-to-end: fresh DB -> build 3 versions -> release -> generate
# site -> run acceptance + partial-upload checks.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV=$(mktemp -d); PORT=4193; PPORT=4194
cleanup(){ ps aux | grep "[s]erver.py --db $ENV" | awk '{print $2}' | xargs -r kill 2>/dev/null || true; rm -rf "$ENV" "$ROOT/dist-partial"; }
trap cleanup EXIT
cd "$ENV"
DOC_ADMIN_PASSWORD=secret python3 "$ROOT/server/server.py" --db docs.db --storage store \
  --site "$ROOT/dist" --port $PORT --preview-port $PPORT >srv.log 2>&1 &
PID=$!; cd "$ROOT"; sleep 1.3
TOKEN=$(curl -s -X POST http://127.0.0.1:$PORT/api/admin/login -H 'Content-Type: application/json' -d '{"password":"secret"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
for v in 1.0.0 2.0.0 3.0.0; do
  node tools/build.mjs --component Button --version $v --commit v$v --branch B \
    --server http://127.0.0.1:$PORT --token "$TOKEN" >"$ENV/build-$v.log"
done
curl -s -X POST http://127.0.0.1:$PORT/api/admin/releases -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"component":"Button","version":"1.0.0"}' >/dev/null
curl -s -X POST http://127.0.0.1:$PORT/api/admin/releases -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"component":"Button","version":"2.0.0","retestResults":{"button.type->variant":true,"button.label-slot":true}}' >/dev/null
curl -s -X POST http://127.0.0.1:$PORT/api/admin/releases -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"component":"Button","version":"3.0.0","retestResults":{"button.label-removed":true}}' >/dev/null
node tools/sitegen.mjs http://127.0.0.1:$PORT/api/site-data "$ROOT/dist" http://127.0.0.1:$PPORT
API=http://127.0.0.1:$PORT PREVIEW=http://127.0.0.1:$PPORT DIST="$ROOT/dist" node tests/acceptance.mjs
