import { parseArgs } from 'node:util';
import path from 'node:path';
import { buildDocsData, writeDocsData } from '../docs/manifest.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      package: { type: 'string', default: '@acme/ui' },
      db: { type: 'string', default: '.data/docs.db' },
      docs: { type: 'string', default: 'docs' },
      draft: { type: 'boolean', default: false },
    },
  });
  const statuses = values.draft
    ? (['complete', 'partial'] as const)
    : (['complete'] as const);
  const data = buildDocsData(values.db!, values.package!, {
    draft: values.draft,
    includeStatuses: [...statuses],
  });
  const out = await writeDocsData(path.resolve(values.docs!), data);
  console.log(`wrote ${data.perVersion.length} version(s) to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
