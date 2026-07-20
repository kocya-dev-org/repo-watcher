import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ja from './locales/ja.json';

/**
 * ブラウザー言語から初期言語を解決する。
 * @param navigatorLanguage ブラウザーの言語
 * @returns 初期言語
 */
export function resolveInitialLanguage(navigatorLanguage?: string): 'ja' | 'en' {
  return typeof navigatorLanguage === 'string' && navigatorLanguage.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: resolveInitialLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export default i18n;
