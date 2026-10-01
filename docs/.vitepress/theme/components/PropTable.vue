<script setup>
defineProps({ props: { type: Array, required: true } })
function val(v) {
  return v && typeof v === 'object' && 'value' in v ? v.value : v
}
</script>

<template>
  <table class="prop-table">
    <thead>
      <tr>
        <th scope="col">Name</th>
        <th scope="col">Type</th>
        <th scope="col">Required</th>
        <th scope="col">Default</th>
        <th scope="col">Description</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in props" :key="p.name" :class="{ deprecated: p.deprecated }">
        <td>
          <code>{{ p.name }}</code>
          <span v-if="p.deprecated" class="badge badge-deprecated"
            >Deprecated since {{ p.deprecated.since }} (removal {{
              p.deprecated.removeIn
            }})</span
          >
        </td>
        <td><code class="type">{{ p.type?.text ?? 'unknown' }}</code></td>
        <td>{{ val(p.required) ? 'yes' : 'no' }}</td>
        <td>
          <code v-if="p.default">{{ JSON.stringify(val(p.default)) }}</code>
          <span v-else>—</span>
        </td>
        <td>{{ p.description?.value ?? '' }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.deprecated {
  opacity: 0.75;
}
.badge-deprecated {
  margin-left: 6px;
  font-size: 11px;
  color: #9a6700;
  background: #fff8c5;
  border-radius: 4px;
  padding: 1px 6px;
}
.type {
  white-space: normal;
  word-break: break-word;
}
</style>
