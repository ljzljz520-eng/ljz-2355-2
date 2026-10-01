import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRoute,
  switchVersionWithIndex,
} from '../packages/core/dist/index.js';

const site = {
  packageName: '@acme/ui',
  defaultVersion: '2.0.0',
  versions: [
    { version: '2.0.0', status: 'complete', commit: 'c2' },
    { version: '1.0.0', status: 'complete', commit: 'c1' },
  ],
};

test('parse route extracts version, section, hash', () => {
  assert.deepEqual(
    parseRoute('/1.0.0/components/cw-button#events'),
    { version: '1.0.0', section: 'components/cw-button', hash: 'events' },
  );
});

test('switching versions keeps component path and anchor', () => {
  const index = new Map([
    ['1.0.0', new Set(['cw-button', 'cw-tree'])],
    ['2.0.0', new Set(['cw-button', 'cw-tree'])],
  ]);
  const cur = parseRoute('/1.0.0/components/cw-button#props');
  assert.equal(
    switchVersionWithIndex(site, '2.0.0', cur, index),
    '/2.0.0/components/cw-button#props',
  );
});

test('unknown target version does NOT fall through to latest', () => {
  const index = new Map([
    ['1.0.0', new Set(['cw-button'])],
    ['2.0.0', new Set(['cw-button'])],
  ]);
  const cur = parseRoute('/1.0.0/components/cw-button#props');
  const out = switchVersionWithIndex(site, '9.9.9', cur, index);
  assert.ok(out.startsWith('/1.0.0/'), out);
});

test('component removed in target falls back to provided page, keeps hash', () => {
  const index = new Map([
    ['1.0.0', new Set(['cw-legacy'])],
    ['2.0.0', new Set(['cw-button'])],
  ]);
  const cur = parseRoute('/1.0.0/components/cw-legacy#props');
  assert.equal(
    switchVersionWithIndex(site, '2.0.0', cur, index, {
      removedComponentFallback: 'components/migrations',
    }),
    '/2.0.0/components/migrations#props',
  );
});
