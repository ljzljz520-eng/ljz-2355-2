<script setup>
defineProps({ slots: { type: Array, required: true } })
</script>

<template>
  <table class="slot-table">
    <thead>
      <tr>
        <th scope="col">Slot</th>
        <th scope="col">Required</th>
        <th scope="col">Description (manual evidence)</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="s in slots" :key="s.name">
        <td><code>{{ s.name }}</code></td>
        <td>{{ s.required ? 'yes' : 'no' }}</td>
        <td>{{ s.description.value }}</td>
      </tr>
      <tr v-if="slots.length === 0">
        <td colspan="3">No slots.</td>
      </tr>
    </tbody>
  </table>
</template>
