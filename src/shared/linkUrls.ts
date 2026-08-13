import { resolveInitialLanguage } from './i18n';

export const getHelpUrl = () => {
  const lang = resolveInitialLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined);
  return `https://kocya-dev-org.github.io/repo-watcher/${lang}/`;
};
