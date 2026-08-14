type MessageSubstitutions = string | string[] | undefined;

/**
 * アプリ内翻訳キーを Chrome i18n のメッセージ名へ変換する。
 * @param messageName アプリ内で使う翻訳キー
 * @returns Chrome i18n 用メッセージ名
 */
function toChromeMessageName(messageName: string): string {
  return messageName.replace(/\./g, '_');
}

/**
 * Chrome UI 言語を docs 用のサポート言語へ正規化する。
 * @param language Chrome UI 言語
 * @returns docs で利用する言語コード
 */
export function normalizeLanguage(language?: string): 'ja' | 'en' {
  return typeof language === 'string' && language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/**
 * 現在の Chrome UI 言語を取得する。
 * @returns Chrome UI 言語。未取得時は undefined
 */
export function getUiLanguage(): string | undefined {
  return globalThis.chrome?.i18n?.getUILanguage?.();
}

/**
 * docs リンクに使う言語コードを返す。
 * @returns docs 用の言語コード
 */
export function resolveHelpLocale(): 'ja' | 'en' {
  return normalizeLanguage(getUiLanguage());
}

/**
 * Chrome i18n からメッセージを取得する。
 * @param messageName アプリ内翻訳キー
 * @param substitutions 置換文字列
 * @returns 取得できたメッセージ。未定義なら undefined
 */
export function getOptionalMessage(messageName: string, substitutions?: MessageSubstitutions): string | undefined {
  const message = globalThis.chrome?.i18n?.getMessage?.(toChromeMessageName(messageName), substitutions);
  return typeof message === 'string' && message.length > 0 ? message : undefined;
}

/**
 * Chrome i18n からメッセージを取得する。
 * @param messageName アプリ内翻訳キー
 * @param substitutions 置換文字列
 * @returns 取得したメッセージ。未定義時はキー名
 */
export function getMessage(messageName: string, substitutions?: MessageSubstitutions): string {
  return getOptionalMessage(messageName, substitutions) ?? messageName;
}
