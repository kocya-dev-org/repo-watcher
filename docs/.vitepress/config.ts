import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Repo Watcher',
  description: '',
  // GitHub Pages project site: set to "/<repo>/" so built assets use correct absolute URLs.
  // For example, this repo is published at https://<org>.github.io/repo-watcher/
  base: '/repo-watcher/',

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
