import { resolveInitialLanguage } from '../src/shared/i18n';

describe('resolveInitialLanguage', () => {
  it.each([
    ['ja', 'ja'],
    ['ja-JP', 'ja'],
    ['JA', 'ja'],
  ])('%s は ja を返す', (navigatorLanguage, expected) => {
    expect(resolveInitialLanguage(navigatorLanguage)).toBe(expected);
  });

  it.each([
    ['en-US', 'en'],
    [undefined, 'en'],
    ['', 'en'],
  ])('%s は en を返す', (navigatorLanguage, expected) => {
    expect(resolveInitialLanguage(navigatorLanguage)).toBe(expected);
  });
});
