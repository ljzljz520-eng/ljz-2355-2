import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import PropTable from './components/PropTable.vue'
import EventTable from './components/EventTable.vue'
import SlotTable from './components/SlotTable.vue'
import ExampleFrame from './components/ExampleFrame.vue'
import BreakingChanges from './components/BreakingChanges.vue'
import VersionSwitcher from './components/VersionSwitcher.vue'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('PropTable', PropTable)
    app.component('EventTable', EventTable)
    app.component('SlotTable', SlotTable)
    app.component('ExampleFrame', ExampleFrame)
    app.component('BreakingChanges', BreakingChanges)
    app.component('VersionSwitcher', VersionSwitcher)
  },
}
