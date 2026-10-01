import { defineConfig } from 'vitepress'
// Each versioned page lives under /components/<Component>/<version>/ and is
// built from the pinned build recorded in its frontmatter -> old docs can never
// resolve the newest component.
export default defineConfig({
  title: 'UI Library Docs',
  lang: 'zh-CN',
  themeConfig: {
    nav: [{ text: '组件', link: '/' }],
    sidebar: {
  "/components/Button/": [
    {
      "text": "Button 1.0.0",
      "link": "/components/Button/1.0.0/"
    },
    {
      "text": "Button 2.0.0",
      "link": "/components/Button/2.0.0/"
    },
    {
      "text": "Button 3.0.0",
      "link": "/components/Button/3.0.0/"
    }
  ]
}
  }
})
