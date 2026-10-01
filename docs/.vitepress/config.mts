import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffoldVersionedPages } from '../../packages/core/dist/docs/scaffold.js'
import type {
  DocsSiteManifest,
  DocsVersionManifest,
} from '../../packages/core/dist/docs/manifest.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const docsRoot = path.resolve(here, '..')
const generated = path.join(docsRoot, '.generated')

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T
}

export default defineConfig(async () => {
  const site = readJson<DocsSiteManifest>(
    path.join(generated, 'versions.json'),
  )
  const manifests: Record<string, DocsVersionManifest> = {}
  for (const v of site.versions) {
    manifests[v.version] = readJson<DocsVersionManifest>(
      path.join(generated, v.version, 'manifest.json'),
    )
  }

  const { rewrites } = await scaffoldVersionedPages(
    docsRoot,
    Object.values(manifests),
  )

  return {
    title: 'ACME UI',
    description: 'Open-source component library documentation',
    cleanUrls: true,
    rewrites,
    srcExclude: ['components/**'], // legacy dynamic page; .pages is used
    themeConfig: {
      nav: [
        { text: '安装', link: '/install' },
        { text: '迁移', link: '/migrations' },
      ],
      sidebar: [
        {
          text: '指南',
          items: [
            { text: '安装与版本固定', link: '/install' },
            { text: '迁移指南', link: '/migrations' },
          ],
        },
        {
          text: '版本',
          items: site.versions.map((v) => ({
            text: `v${v.version}`,
            link: `/${v.version}`,
          })),
        },
      ],
    },
    // Pages receive all version manifests but only index their own version.
    transformPageData(pageData) {
      pageData.docManifests = manifests
      pageData.docSite = site
    },
  }
})
