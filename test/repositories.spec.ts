import { describe, expect, it } from 'vitest';

import { isValidRepo } from '../src/shared/repositories';

describe('isValidRepo', () => {
  it('owner と name が非空文字列なら true を返す', () => {
    expect(isValidRepo({ owner: 'octo', name: 'repo' })).toBe(true);
    expect(isValidRepo({ owner: 'octo', name: 'repo', color: '#fff' })).toBe(true);
  });

  it('owner または name が欠落・空文字なら false を返す', () => {
    expect(isValidRepo({ owner: '', name: 'repo' })).toBe(false);
    expect(isValidRepo({ owner: 'octo', name: '' })).toBe(false);
    expect(isValidRepo({ owner: 'octo' })).toBe(false);
    expect(isValidRepo({ name: 'repo' })).toBe(false);
  });

  it('オブジェクト以外や null は false を返す', () => {
    expect(isValidRepo(null)).toBe(false);
    expect(isValidRepo(undefined)).toBe(false);
    expect(isValidRepo('octo/repo')).toBe(false);
    expect(isValidRepo(42)).toBe(false);
  });
});
