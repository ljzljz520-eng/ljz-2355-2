// Serves the rewritten example module. Environment variables are available to
// the hooks thread; COMPODOC_HOOKS names the per-example JSON config.
import fs from 'node:fs';

export async function load(url, context, nextLoad) {
  const configPath = process.env.COMPODOC_HOOKS;
  if (configPath) {
    let config;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      config = null;
    }
    if (config && url === config.url) {
      return { format: 'module', source: config.source, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}
