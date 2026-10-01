#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc -p packages/core/tsconfig.json
cp packages/core/src/examples/worker-runner.mjs packages/core/dist/examples/
cp packages/core/src/examples/worker-register.mjs packages/core/dist/examples/
cp packages/core/src/examples/worker-hooks.mjs packages/core/dist/examples/
cp packages/core/src/db/schema.sql packages/core/dist/db/schema.sql
