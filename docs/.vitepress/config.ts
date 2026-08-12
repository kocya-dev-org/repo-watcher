import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Repo Watcher',
  description: '',
  base: '/',

  themeConfig: {
    socialLinks: [{ icon: 'github', link: 'https://github.com/kocya-dev-org/repo-watcher' }],
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      themeConfig: {
        sidebar: [
          {
            items: [{ text: 'Manual', link: '/en/' }],
          },
        ],
      },
    },
    ja: {
      label: 'Japanese',
      lang: 'ja',
      link: '/ja/',
      themeConfig: {
        sidebar: [
          {
            items: [{ text: 'Manual', link: '/ja/' }],
          },
        ],
      },
    },
  },
});
