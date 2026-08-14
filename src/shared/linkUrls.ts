import { resolveHelpLocale } from './i18n';

export const getHelpUrl = () => {
  const lang = resolveHelpLocale();
  return `https://kocya-dev-org.github.io/repo-watcher/${lang}/`;
};
