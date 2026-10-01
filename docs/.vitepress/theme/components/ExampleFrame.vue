<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  version: { type: String, required: true },
  component: { type: String, required: true },
  slug: { type: String, required: true },
  title: { type: String, default: '' },
  // Only passed examples carry pre-rendered HTML from the same build.
  html: { type: String, default: '' },
})

// Restricted preview origin. Resolved at build config time; defaults to a
// sibling, registrable origin so login cookies on the main site are never
// sent (cross-site + sandbox without allow-same-origin).
const PREVIEW_ORIGIN =
  (import.meta.env.VITE_PREVIEW_ORIGIN ?? 'https://preview.example.invalid')
    .replace(/\/$/, '')

const failed = ref(false)
const loading = ref(true)
let frameEl = null

// If the framed example does not load (preview offline / blocked), the rest
// of the documentation page stays fully functional — we show a notice.
function onLoad() {
  loading.value = false
}
function onError() {
  failed.value = true
  loading.value = false
}
function timeoutGuard() {
  if (loading.value) {
    failed.value = true
    loading.value = false
  }
}
let timer
onMounted(() => {
  timer = setTimeout(timeoutGuard, 4000)
})
onBeforeUnmount(() => clearTimeout(timer))

const src = `${PREVIEW_ORIGIN}/run/${encodeURIComponent(props.version)}/${encodeURIComponent(
  props.component,
)}/${encodeURIComponent(props.slug)}`
</script>

<template>
  <figure class="example-frame">
    <figcaption>
      <strong>{{ title || slug }}</strong>
      <span class="tag tag-ok">verified · v{{ version }}</span>
    </figcaption>
    <p v-if="failed" class="example-fallback" role="status">
      Interactive preview is unavailable in this environment. The example was
      verified at build time; rendered output is shown statically below.
    </p>
    <div class="example-static" v-html="html" aria-hidden="true" />
    <iframe
      v-show="!failed"
      ref="frameEl"
      :src="src"
      :title="`Interactive example: ${title || slug}`"
      loading="lazy"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      allow=""
      @load="onLoad"
      @error="onError"
    />
  </figure>
</template>

<style scoped>
.example-frame {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 12px;
  margin: 16px 0;
}
.example-frame iframe {
  width: 100%;
  min-height: 120px;
  border: 0;
  display: block;
}
.tag-ok {
  font-size: 11px;
  color: #1a7f37;
  margin-left: 8px;
}
.example-fallback {
  color: #9a6700;
  font-size: 13px;
}
</style>
