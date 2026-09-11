import { resolveHelpLocale } from './i18n';

export const getHelpUrl = () => {
  const lang = resolveHelpLocale();
  return `https://kocya-dev-org.github.io/repo-watcher/${lang}/`;
};

export const getWebStoreUrl = () =>
  'https://chromewebstore.google.com/detail/repo-watcher/pkdlkkifdpmkifnbjkminaakjebbhdao';
