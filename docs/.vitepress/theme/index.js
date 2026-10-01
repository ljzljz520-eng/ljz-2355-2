import DefaultTheme from 'vitepress/theme'
import DemoPreview from './components/DemoPreview.vue'
import ExampleGallery from './components/ExampleGallery.vue'
import VersionSwitcher from './components/VersionSwitcher.vue'
export default { extends: DefaultTheme, enhanceApp({ app }) { app.component('DemoPreview', DemoPreview); app.component('ExampleGallery', ExampleGallery); app.component('VersionSwitcher', VersionSwitcher) } }
