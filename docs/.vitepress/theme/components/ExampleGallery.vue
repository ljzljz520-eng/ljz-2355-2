<template>
  <div>
    <p v-if="!examples.length" class="empty">没有通过门控并完成上传的示例可用于正式页面。</p>
    <DemoPreview v-for="ex in examples" :key="ex.name" :example="ex" :preview-origin="previewOrigin" />
  </div>
</template>
<script setup>
// Resolves ONLY the examples pinned to this page's component+version, from the
// build-time site-data snapshot. Never fetches a floating "latest" build.
import { ref, onMounted } from 'vue'
import { useData } from 'vitepress'
const props = defineProps({ component: String, version: String, previewOrigin: String })
const { frontmatter } = useData()
const examples = ref([])
onMounted(async () => {
  const all = await (await fetch('/site-data.json')).json()
  const ver = all.components[props.component].versions.find(v => v.version === props.version && v.buildId === frontmatter.buildId)
  examples.value = ver ? ver.examples : []
})
</script>
