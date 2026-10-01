import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  staticExtractPackage,
  runtimeReflectPackage,
  mergePackage,
} from '../packages/core/dist/index.js';

test('static extraction beats runtime on types; runtime beats static on evaluated defaults', async () => {
  const root = path.resolve('test/fixtures/v2');
  const staticResult = staticExtractPackage(root, path.join(root, 'src/index.ts'));
  const runtime = await runtimeReflectPackage(root, path.join(root, 'src/index.ts'));

  const buttonRt = runtime.find((r) => r.name === 'cw-button');
  const busyRt = buttonRt.props.find((p) => p.name === 'busy');
  assert.equal(busyRt.hasDefault, true);
  assert.deepEqual(busyRt.defaultValue, { pending: false });

  const buttonSt = staticResult.find(
    (r) => r.component.name === 'cw-button',
  );
  const busySt = buttonSt.component.props.find((p) => p.name === 'busy');
  // Static type info is rich and structural...
  assert.match(busySt.type.text, /pending/);
  // ...while the runtime type is intentionally coarse.
  assert.equal(busyRt.runtimeType, 'unknown');

  // Tree's factory default [] is evaluable only at runtime.
  const treeRt = runtime.find((r) => r.name === 'cw-tree');
  const exp = treeRt.props.find((p) => p.name === 'initiallyExpanded');
  assert.deepEqual(exp.defaultValue, []);
});

test('merge records gaps for missing descriptions and undeclared events', async () => {
  const root = path.resolve('test/fixtures/v1');
  const st = staticExtractPackage(root, path.join(root, 'src/index.ts'));
  const rt = await runtimeReflectPackage(root, path.join(root, 'src/index.ts'));
  // No evidence supplied: slots (non-inferable) must show up as gaps.
  const report = mergePackage(st, rt, undefined);
  assert.ok(report.gaps.some((g) => g.includes('slots.default')));
  assert.ok(report.gaps.some((g) => g.includes('slots.node')));
});
