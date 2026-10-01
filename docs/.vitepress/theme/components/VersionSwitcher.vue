<script setup>
import { computed } from 'vue'
import { useData, useRoute } from 'vitepress'
import { ref } from 'vue'

const { site, lang } = useData()
const route = useRoute()
const versions = computed(() => site.value.versions ?? [])
const current = computed(() => {
  const m = route.path.match(/^\/(\d+\.\d+\.\d+)(?:\/|$)/)
  return m ? m[1] : (site.value.defaultVersion ?? '')
})

function onChange(e) {
  const target = e.target.value
  const path = route.path.replace(/^\/\d+\.\d+\.\d+/, `/${target}`)
  // Preserve the in-page section anchor (props/events/slots/examples).
  const hash = window.location.hash
  window.location.assign(path + hash)
}
</script>

<template>
  <label class="version-switcher">
    <span class="visually-hidden">Version</span>
    <select
      :value="current"
      :aria-label="`Docs version (current ${current})`"
      @change="onChange"
    >
      <option v-for="v in versions" :key="v.version" :value="v.version">
        v{{ v.version }}
        <template v-if="v.version === site.defaultVersion"> (latest)</template>
      </option>
    </select>
  </label>
</template>

<style scoped>
.version-switcher select {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--vp-cpp-border);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
