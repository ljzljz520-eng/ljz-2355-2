<script setup>
defineProps({ changes: { type: Array, required: true } })
</script>

<template>
  <div v-if="changes.length" class="breaking">
    <h3>Breaking changes &amp; migration</h3>
    <details
      v-for="c in changes"
      :key="c.key"
      :open="c.kind.startsWith('prop-removed') || c.kind === 'slot-removed'"
    >
      <summary>
        <span class="kind">{{ c.kind }}</span>
        <code>{{ c.component }}:{{ c.path }}</code>
        <span v-if="c.to">→ <code>{{ c.to }}</code></span>
        <span class="rev" :class="c.reverifyPassed ? 'ok' : 'bad'">
          reverify {{ c.reverifyPassed ? 'passed' : 'failed' }}
        </span>
      </summary>
      <p v-if="c.migration"><strong>{{ c.migration.title }}</strong></p>
      <p v-if="c.migration">{{ c.migration.guide }}</p>
      <ul v-if="c.migration">
        <li v-for="r in c.migration.reverify" :key="r.name">
          ✅ {{ r.name }} — expected <code>{{ r.expect }}</code>
        </li>
      </ul>
      <p v-if="c.reverifyError" class="reverify-error">
        ⚠ {{ c.reverifyError }}
      </p>
    </details>
  </div>
</template>

<style scoped>
.kind {
  display: inline-block;
  min-width: 150px;
  font-size: 12px;
  color: #cf222e;
}
.rev.ok {
  color: #1a7f37;
  font-size: 11px;
  margin-left: 8px;
}
.rev.bad {
  color: #cf222e;
  font-size: 11px;
  margin-left: 8px;
}
.reverify-error {
  color: #cf222e;
}
</style>
