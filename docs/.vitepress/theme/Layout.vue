<script setup>
import DefaultTheme from 'vitepress/theme'
import VersionSwitcher from './components/VersionSwitcher.vue'
const { Layout: DefaultLayout } = DefaultTheme
</script>

<template>
  <DefaultLayout>
    <template #nav-bar-content-before>
      <VersionSwitcher />
    </template>
  </DefaultLayout>
</template>
