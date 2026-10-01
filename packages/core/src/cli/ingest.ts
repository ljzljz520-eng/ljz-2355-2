import { parseArgs } from 'node:util';
import { ingestRelease } from '../ingest.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      ref: { type: 'string' },
      package: { type: 'string', default: '@acme/ui' },
      version: { type: 'string' },
      db: { type: 'string', default: '.data/docs.db' },
      subdir: { type: 'string', default: '' },
      timeout: { type: 'string', default: '2000' },
    },
  });
  if (!values.repo || !values.ref || !values.version) {
    console.error('Usage: ingest --repo <dir> --ref <git-ref> --version <semver>');
    process.exit(2);
  }
  const report = await ingestRelease({
    repoDir: values.repo,
    ref: values.ref!,
    packageName: values.package!,
    version: values.version!,
    dbPath: values.db!,
    sourceSubdir: values.subdir || undefined,
    timeoutMs: Number(values.timeout),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === 'blocked') process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
