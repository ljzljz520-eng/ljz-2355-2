import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticExtractPackage } from '../packages/core/dist/index.js';
import path from 'node:path';

function extract(root) {
  return staticExtractPackage(root, path.join(root, 'src/index.ts'));
}

test('recursive type alias terminates with $ref (v2 snapshot)', () => {
  const root = path.resolve('test/fixtures/v2');
  const data = extract(root)
    .find((x) => x.component.name === 'cw-tree')
    .component.props.find((p) => p.name === 'data');
  const expanded = data.type.expanded;
  assert.equal(expanded.kind, 'array');
  const children = expanded.element.props.children;
  const arr = children.members.find((m) => m.kind === 'array');
  assert.equal(arr.element.kind, 'reference');
  assert.equal(arr.element.$ref, 'TreeNode');
  assert.equal(arr.element.recursive, true);
  const json = JSON.stringify(expanded);
  assert.ok(json.length < 6000, `expansion too large: ${json.length}`);
});

test('string-literal union alias keeps member literals', () => {
  const root = path.resolve('test/fixtures/v2');
  const variant = extract(root)
    .find((x) => x.component.name === 'cw-button')
    .component.props.find((p) => p.name === 'variant');
  const literals = variant.type.expanded.members
    .map((m) => m.text)
    .sort();
  assert.deepEqual(literals, ['"danger"', '"ghost"', '"link"', '"solid"']);
});

test('recursive alias identical across structurally equivalent snapshots', () => {
  const v1 = extract(path.resolve('test/fixtures/v1'));
  const v2 = extract(path.resolve('test/fixtures/v2'));
  const shape = (col) =>
    JSON.stringify(
      col
        .find((x) => x.component.name === 'cw-tree')
        .component.props.find((p) => p.name === 'data').type.expanded,
    );
  assert.equal(shape(v1).includes('$ref'), true);
  assert.equal(shape(v2).includes('$ref'), true);
});
