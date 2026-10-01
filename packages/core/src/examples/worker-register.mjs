// Loaded via --import inside each example worker. The worker is spawned with
// COMPODOC_HOOKS in its env pointing at a per-example JSON config.
try {
  const { register } = await import('node:module');
  register(new URL('./worker-hooks.mjs', import.meta.url));
} catch (err) {
  // Hook setup failure must surface as an example failure, never terminate
  // the whole ingest process.
  process.on('uncaughtException', () => {});
  console.error('[compodoc] hook registration failed:', err?.message);
}
