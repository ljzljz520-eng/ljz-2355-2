---
aside: false
---
<script setup>
import { useData } from 'vitepress'
import { computed } from 'vue'
import PropTable from '../.vitepress/theme/components/PropTable.vue'
import EventTable from '../.vitepress/theme/components/EventTable.vue'
import SlotTable from '../.vitepress/theme/components/SlotTable.vue'
import ExampleFrame from '../.vitepress/theme/components/ExampleFrame.vue'
import BreakingChanges from '../.vitepress/theme/components/BreakingChanges.vue'

const { params, site } = useData()

// Per-version manifest is registered globally by config.mts (loaded from
// .generated/<version>/manifest.json produced by the SAME docs build).
const version = computed(() => site.value.docVersion)
const manifest = computed(() => site.value.docManifest)
const component = computed(
  () => manifest.value?.components.find((c) => c.name === params.value.component),
)
const relevantChanges = computed(
  () =>
    manifest.value?.breakingChanges.filter(
      (c) => c.component === component.value?.name,
    ) ?? [],
)
</script>

<h1>{{ component?.name }}</h1>
<p class="version-meta">
  Package <code>@acme/ui</code> · version
  <strong>{{ version }}</strong> · commit
  <code>{{ manifest?.commit.slice(0, 8) }}</code>
</p>

<p>{{ component?.description }}</p>

<BreakingChanges :changes="relevantChanges" />

<h2 id="props">Props</h2>
<PropTable :props="component?.props ?? []" />

<h2 id="events">Events</h2>
<EventTable :events="component?.events ?? []" />

<h2 id="slots">Slots</h2>
<p class="hint">Slots cannot be inferred automatically; the table below is
human-supplied evidence cross-checked against render usage.</p>
<SlotTable :slots="component?.slots ?? []" />

<h2 id="examples">Examples</h2>
<p class="hint">Only examples that passed build-time render and accessibility
checks in the same build are embedded. Failures are never published here.</p>
<ExampleFrame
  v-for="ex in component?.examples ?? []"
  :key="ex.slug"
  :version="version"
  :component="component.name"
  :slug="ex.slug"
  :title="ex.title"
  :html="ex.html"
/>
