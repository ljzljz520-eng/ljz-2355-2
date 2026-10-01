<script setup>
defineProps({ events: { type: Array, required: true } })
</script>

<template>
  <table class="event-table">
    <thead>
      <tr>
        <th scope="col">Event</th>
        <th scope="col">Payload</th>
        <th scope="col">Description</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="ev in events" :key="ev.name">
        <td><code>{{ ev.name }}</code></td>
        <td><code class="type">{{ ev.payloadType?.text ?? 'void' }}</code></td>
        <td>{{ ev.description?.value ?? '' }}</td>
      </tr>
    </tbody>
  </table>
</template>
