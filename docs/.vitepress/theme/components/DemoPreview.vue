<template>
  <div class="demo">
    <h4>{{ example.name }}</h4>
    <!-- isolated origin; user code cannot reach main-site login context -->
    <iframe :title="'示例预览 ' + example.name" sandbox="allow-scripts"
      :src="previewOrigin + '/preview/' + example.hash"
      @error="onError" />
    <div v-if="errorMsg" class="demo-error">{{ errorMsg }}</div>
  </div>
</template>
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
const props = defineProps({ example: Object, previewOrigin: String })
const errorMsg = ref('')
function onMsg(e) { if (e.data?.type === 'example-error') errorMsg.value = '示例失败已隔离：' + e.data.message }
function onError() { errorMsg.value = '预览加载失败（已隔离）' }
onMounted(() => window.addEventListener('message', onMsg))
onUnmounted(() => window.removeEventListener('message', onMsg))
</script>
