import fs from 'node:fs/promises';
import path from 'node:path';
import type { DocsVersionManifest } from './manifest.js';

export interface ScaffoldResult {
  rewrites: Record<string, string>;
  tempDir: string;
}

const COMPONENT_PAGE = `---
aside: false
---
<script setup>
import { useData } from 'vitepress'
const { page } = useData()
const docVersion = __VERSION_LITERAL__
const manifest = page.value.docManifests[docVersion]
const component = manifest.components.find((c) => c.name === __COMPONENT__)
const changes = manifest.breakingChanges.filter((c) => c.component === __COMPONENT__)
</script>

<h1>{{ component.name }}</h1>
<p class="version-meta">Package <code>@acme/ui</code> · version
<strong>{{ manifest.version }}</strong> · commit
<code>{{ manifest.commit.slice(0, 8) }}</code></p>
<p>{{ component.description }}</p>

<BreakingChanges :changes="changes" />

<h2 id="props">Props</h2>
<PropTable :props="component.props" />

<h2 id="events">Events</h2>
<EventTable :events="component.events" />

<h2 id="slots">Slots</h2>
<p class="hint">Slots cannot be inferred automatically; descriptions are
human-supplied evidence cross-checked against render usage.</p>
<SlotTable :slots="component.slots" />

<h2 id="examples">Examples</h2>
<p class="hint">Only examples that passed render and accessibility checks in
the same build are embedded. Failed examples are never published.</p>
<ExampleFrame
  v-for="ex in component.examples"
  :key="ex.slug"
  :version="manifest.version"
  :component="component.name"
  :slug="ex.slug"
  :title="ex.title"
  :html="ex.html"
/>
`;

const VERSION_INDEX = `---
layout: page
---
<script setup>
import { useData } from 'vitepress'
const { page } = useData()
const docVersion = __VERSION_LITERAL__
const manifest = page.value.docManifests[docVersion]
</script>

<h1>@acme/ui v{{ manifest.version }}</h1>
<p>Commit <code>{{ manifest.commit.slice(0, 8) }}</code> · tree
<code>{{ manifest.treeHash.slice(0, 8) }}</code> · status
<strong>{{ manifest.status }}</strong></p>

<h2>Components</h2>
<ul>
  <li v-for="c in manifest.components" :key="c.name">
    <a :href="docVersion + '/components/' + c.name + '#props'">{{ c.name }}</a>
    — {{ c.description }}
  </li>
</ul>

<h2>Breaking changes</h2>
<p v-if="!manifest.breakingChanges.length">None in this release.</p>
<ul>
  <li v-for="b in manifest.breakingChanges" :key="b.key">
    <a :href="docVersion + '/components/' + b.component + '#props'">
      <code>{{ b.kind }}</code> {{ b.component }}:{{ b.path }}
    </a>
  </li>
</ul>
`;

/**
 * Materialize one markdown file per component per version under .pages/,
 * returning VitePress `rewrites` so final URLs are version-prefixed and a
 * versioned page can never resolve another version's component data.
 */
export async function scaffoldVersionedPages(
  docsDir: string,
  manifests: DocsVersionManifest[],
): Promise<ScaffoldResult> {
  const tempDir = path.join(docsDir, 'generated-pages');
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });
  const rewrites: Record<string, string> = {};

  for (const m of manifests) {
    const v = m.version;
    await fs.mkdir(path.join(tempDir, v), { recursive: true });
    for (const c of m.components) {
      const body = COMPONENT_PAGE.replace(
        /__VERSION_LITERAL__/g,
        JSON.stringify(v),
      ).replace(/__COMPONENT__/g, JSON.stringify(c.name));
      await fs.writeFile(
        path.join(tempDir, v, `component-${c.name}.md`),
        body,
      );
      rewrites[`generated-pages/${v}/component-${c.name}.md`] =
        `${v}/components/${c.name}.md`;
    }
    const indexBody = VERSION_INDEX.replace(
      /__VERSION_LITERAL__/g,
      JSON.stringify(v),
    );
    await fs.writeFile(path.join(tempDir, v, 'index.md'), indexBody);
    rewrites[`generated-pages/${v}/index.md`] = `${v}/index.md`;
  }
  return { rewrites, tempDir };
}
