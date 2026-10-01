import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runA11yChecks } from '../packages/core/dist/examples/a11y.js';

test('button without accessible name is an a11y violation', () => {
  const v = runA11yChecks('<button>   </button>');
  assert.ok(v.some((x) => x.rule === 'button-name'));
});

test('button with text content passes', () => {
  const v = runA11yChecks('<button>Save</button>');
  assert.equal(v.length, 0);
});

test('icon-only button needs aria-label', () => {
  assert.ok(
    runA11yChecks('<button><span aria-hidden="true">x</span></button>').some(
      (x) => x.rule === 'button-name',
    ),
  );
  assert.equal(
    runA11yChecks('<button aria-label="Search">x</button>').length,
    0,
  );
});

test('images require alt; duplicate ids flagged; html requires lang', () => {
  assert.ok(runA11yChecks('<img src="x.png">').some((x) => x.rule === 'img-alt'));
  const dup = runA11yChecks(
    '<div id="a"></div><div id="a"></div>',
  );
  assert.ok(dup.some((x) => x.rule === 'duplicate-id'));
  assert.ok(
    runA11yChecks('<html><body></body></html>').some(
      (x) => x.rule === 'html-has-lang',
    ),
  );
});

test('unlabeled input is flagged, labelled passes', () => {
  assert.ok(
    runA11yChecks('<input type="text">').some((x) => x.rule === 'label'),
  );
  assert.equal(
    runA11yChecks(
      '<label for="n">Name</label><input id="n" type="text">',
    ).filter((x) => x.rule === 'label').length,
    0,
  );
});
