import { defineConfig } from 'vitepress'
import { fileURLToPath } from 'node:url'
import { installSafeDocumentAnchors } from '../../scripts/markdown.mjs'
import * as generatedNavigation from './sidebar-data.mjs'

const generatedNav = generatedNavigation.nav ?? [
  { text: '新版结构', link: '/' },
  ...(generatedNavigation.historySidebar?.length
    ? [{ text: '历史资料', link: generatedNavigation.historySidebar[0].link }]
    : []),
]
const generatedSidebar = generatedNavigation.sidebar ?? [
  ...(generatedNavigation.historySidebar?.length
    ? [
        {
          text: '历史稿与资料',
          collapsed: true,
          items: generatedNavigation.historySidebar,
        },
      ]
    : []),
]

export default defineConfig({
  title: '随时修仙·设计文档',
  description: '《随时修仙》山海版设计文档',
  lang: 'zh-CN',
  base: '/',
  srcDir: 'content',
  outDir: '../cache/vitepress-dist',
  cleanUrls: false,
  ignoreDeadLinks: false,
  appearance: 'dark',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],
  vite: {
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  },
  markdown: {
    html: false,
    config: installSafeDocumentAnchors,
  },
  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: '随时修仙·设计文档',
    nav: generatedNav,
    sidebar: generatedSidebar,
    outline: {
      level: [2, 3],
      label: '章节目录',
    },
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '外观',
    darkModeSwitchTitle: '切换到暗色模式',
    lightModeSwitchTitle: '切换到浅色模式',
    notFound: '页面不存在',
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '搜索',
                buttonAriaLabel: '搜索文档',
              },
              modal: {
                noResultsText: '没有找到结果',
                resetButtonTitle: '清除搜索',
                footer: {
                  selectText: '选择',
                  navigateText: '导航',
                  closeText: '关闭',
                },
              },
            },
          },
        },
      },
    },
  },
})
