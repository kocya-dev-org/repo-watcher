import { getMessage, normalizeLanguage, resolveHelpLocale } from '../src/shared/i18n';

describe('normalizeLanguage', () => {
  it.each([
    ['ja', 'ja'],
    ['ja-JP', 'ja'],
    ['JA', 'ja'],
  ])('%s は ja を返す', (language, expected) => {
    expect(normalizeLanguage(language)).toBe(expected);
  });

  it.each([
    ['en-US', 'en'],
    [undefined, 'en'],
    ['', 'en'],
  ])('%s は en を返す', (language, expected) => {
    expect(normalizeLanguage(language)).toBe(expected);
  });
});

describe('resolveHelpLocale', () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    if (originalChrome) {
      globalThis.chrome = originalChrome;
      return;
    }

    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('Chrome UI 言語から docs 用ロケールを解決する', () => {
    globalThis.chrome = {
      i18n: {
        getUILanguage: () => 'ja-JP',
      },
    } as typeof chrome;

    expect(resolveHelpLocale()).toBe('ja');
  });
});

describe('getMessage', () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    if (originalChrome) {
      globalThis.chrome = originalChrome;
      return;
    }

    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('ドット区切りキーを Chrome メッセージ名へ変換して取得する', () => {
    const getMessageMock = vi.fn((messageName: string) => (messageName === 'save_success' ? '保存しました' : ''));
    globalThis.chrome = {
      i18n: {
        getMessage: getMessageMock,
        getUILanguage: () => 'ja',
      },
    } as typeof chrome;

    expect(getMessage('save.success')).toBe('保存しました');
    expect(getMessageMock).toHaveBeenCalledWith('save_success', undefined);
  });

  it('メッセージ未定義時はキー名を返す', () => {
    globalThis.chrome = {
      i18n: {
        getMessage: () => '',
        getUILanguage: () => 'ja',
      },
    } as typeof chrome;

    expect(getMessage('missing.key')).toBe('missing.key');
  });
});
