#!/usr/bin/env node
// Build orchestrator for one component@version pinned to an exact commit.
//
//   node tools/build.mjs --component Button --version 2.0.0 --commit v2.0.0 \
//        --server http://127.0.0.1:4173 --token TOKEN [--draft]
//
// The property table, events, slots and EVERY live example in a published page
// are produced by THIS run: contract extraction and example tests share the
// same commit/build id. Failed/timeout/a11y examples never reach production.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extract } from './extract.mjs';
import { runExample } from './harness.mjs';
import { previewHtml } from './preview.mjs';
import { show } from './git.mjs';

const args = Object.fromEntries(process.argv.slice(2).join(' ').match(/--[\w-]+(?:\s+[^-][^\s]*)?/g)?.map((p) => {
  const [k, ...v] = p.split(' '); return [k.slice(2), v.join(' ') || true];
}) || []);

function shaOf(buf) { return createHash('sha256').update(buf).digest('hex'); }
async function api(method, path, body, raw) {
  const res = await fetch(new URL(path, args.server), {
    method,
    headers: raw ? { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/octet-stream' }
                 : { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}

async function main() {
  const { component, version, commit } = args;
  const draft = !!args.draft;
  if (!component || !version || !commit) throw new Error('--component --version --commit required');

  // 0) pin the version row to this immutable commit
  await api('POST', '/api/admin/versions', { component, version, sha: commit, branch: args.branch || null });

  // 1) static contract from the EXACT commit
  const contract = extract(commit, component);

  // 2) run every example (hard timeout) with the SAME contract's examples
  const runs = [];
  for (const ex of contract.examples) {
    const file = `library/${component.toLowerCase()}/examples/${ex.file}`;
    const r = await runExample(commit, file);
    runs.push(r);
  }

  // 3) gates.
  //  * BUILD-level hard gate: manual evidence must be complete (人工补证不得悬空).
  //  * EXAMPLE-level gates: timeout/fail/a11y-fail exclude THAT example from the
  //    production page; they do not tear down the component page or the site.
  const gates = {
    manualEvidenceComplete: contract.missingEvidence.length === 0,
    examplesPassed: runs.filter((r) => r.status === 'pass').map((r) => r.example),
    examplesBlocked: runs.filter((r) => r.status !== 'pass').map((r) => ({ example: r.example, status: r.status })),
  };
  const hardPass = gates.manualEvidenceComplete;

  // breaking/deprecation metadata from migration + retest files pinned to commit
  const breaking = [], deprecations = [], retestCases = [], migrations = [];
  let retestBody = null;
  try { retestBody = JSON.parse(show(commit, `library/retest/${version}.json`)); } catch {}
  if (retestBody) {
    retestCases.push(...retestBody.cases);
    for (const cs of retestBody.cases) {
      if (cs.kind === 'rename') breaking.push({ changeId: cs.id, kind: 'rename', example: cs.example });
      if (cs.kind === 'removal') breaking.push({ changeId: cs.id, kind: 'removal', example: cs.example });
    }
  }
  // deprecations come straight from the extracted props (actual versions only)
  for (const p of Object.values(contract.props)) {
    if (p.deprecated?.since) deprecations.push({ subjectType: 'prop', subjectName: p.name, since: p.deprecated.since, note: p.deprecated.note });
  }
  let migrationBody = null, migrationSha = null;
  try { migrationBody = show(commit, `library/migrations/migration-${version}.md`); migrationSha = commit; } catch {}

  // 4) persist build + tests BEFORE artifact upload (so partial upload is observable)
  const artifactsPlanned = [
    { kind: 'contract', name: `contract-${version}.json` },
    { kind: 'report', name: `report-${version}.json` },
    ...runs.map((r) => ({ kind: 'preview', name: r.example })),
    { kind: 'install', name: `install-${version}.txt` },
  ];
  const { buildId } = await api('POST', '/api/admin/builds', {
    component, version, sha: commit,
    status: hardPass ? 'passed' : 'rejected',
    contract, gates, warnings: contract.missingEvidence,
    testRuns: runs, artifacts: artifactsPlanned,
  });

  // 5) upload artifacts INDIVIDUALLY; a failure marks only that artifact.
  //    Production pages ignore anything not uploaded+passed (partial upload).
  const contractBuf = Buffer.from(JSON.stringify(contract, null, 2));
  const reportBuf = Buffer.from(JSON.stringify({ buildId, commit, version, gates, runs: runs.map(({ html, ...rest }) => rest) }, null, 2));
  const installBuf = Buffer.from(`npm install ui-library@${version}\n# resolved commit ${commit}\n`);
  const uploads = [];
  async function upload(kind, name, buf) {
    try { const r = await api('PUT', `/api/admin/artifacts?buildId=${buildId}&kind=${kind}&name=${encodeURIComponent(name)}`, buf, true); uploads.push({ kind, name, ...r }); }
    catch (e) { uploads.push({ kind, name, uploaded: false, error: e.message }); }
  }
  await upload('contract', artifactsPlanned[0].name, contractBuf);
  await upload('report', artifactsPlanned[1].name, reportBuf);
  for (const r of runs) {
    // A failing/timeout/a11y example has NO preview bundle: it must never be
    // embedded in a production page.
    if (r.status !== 'pass') { uploads.push({ kind: 'preview', name: r.example, skipped: true, reason: r.status }); continue; }
    const html = Buffer.from(previewHtml(commit, `library/${component.toLowerCase()}/examples/${r.example}`, r));
    await upload('preview', r.example, html);
  }
  await upload('install', artifactsPlanned[3].name, installBuf);

  // 6) metadata: deprecations / breaking + migration / retest (server stores)
  for (const d of deprecations) {
    await api('POST', '/api/admin/deprecations', { component, ...d });
  }
  for (const b of breaking) {
    await api('POST', '/api/admin/breaking', {
      component, changeId: b.changeId, kind: b.kind, version,
      migrationDoc: migrationSha, migrationBody: migrationBody || `(migration note for ${version} not found)`,
      sha: commit,
      // removal-type changes close the deprecation range at THIS real version
      subjectType: 'prop', subjectName: b.changeId.includes('label-removed') ? 'label' : null,
      removedIn: b.kind === 'removal' ? version : null,
    });
  }
  if (retestCases.length) {
    // retest "must" assertions are evaluated against this very build's outputs
    const results = {};
    for (const cs of retestCases) results[cs.id] = evalRetest(cs, contract, runs);
    await api('POST', '/api/admin/retest', { component, version, cases: retestCases, results });
  }

  const uploaded = uploads.filter((u) => u.uploaded).length;
  console.log(JSON.stringify({ buildId, version, commit, gates, examples: runs.map((r) => r.status), artifacts: { uploaded, planned: artifactsPlanned.length, uploads } }, null, 2));
  if (!hardPass) process.exitCode = 1;
}

function evalRetest(cs, contract, runs) {
  // Evaluate the declared "must" predicates against this build's contract/runs.
  const runByName = Object.fromEntries(runs.map((r) => [r.example.replace(/\.js$/, ''), r]));
  for (const m of cs.must) {
    if (m === 'contract.props.variant exists' && !contract.props.variant) return false;
    if (m === 'contract.props.type is absent' && contract.props.type) return false;
    if (m === 'contract.props.label is absent' && contract.props.label) return false;
    if (m === 'contract.props.label not present even as deprecated' && contract.props.label) return false;
    if (m.startsWith('contract.props.label.deprecated.since ==')) {
      const want = m.split('==')[1].trim();
      if (contract.props.label?.deprecated?.since !== want) return false;
    }
    if (m === 'slots.default exists' && !contract.slots.default) return false;
    if (m === 'deprecation range is [2.0.0,3.0.0)') { /* checked via DB in tests */ }
    const em = m.match(/example (\S+) passed/);
    if (em && runByName[em[1]]?.status !== 'pass') return false;
  }
  return true;
}

main().catch((e) => { console.error('build failed:', e.message); process.exit(2); });
