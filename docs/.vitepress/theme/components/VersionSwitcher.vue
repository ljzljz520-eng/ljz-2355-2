<template>
  <select @change="go">
    <option v-for="o in versions" :key="o.version" :selected="o.version === current">{{ o.version }}</option>
  </select>
</template>
<script setup>
// Anchors (#props/#events/#slots/#examples/#install) are stable across versions
// so switching versions keeps the reader on the same section.
import { useRoute, useRouter } from 'vitepress'
const props = defineProps({ versions: Array, current: String, component: String })
function go(e) {
  const hash = location.hash || ''
  const y = hash ? window.scrollY : 0
  sessionStorage.setItem('vp-switch-y', String(y))
  location.href = '/components/' + props.component + '/' + e.target.value + '/' + hash
}
</script>
