import { describe, expect, it } from 'vitest';

import { REFRESH_WATCH_CYCLE_MESSAGE, isRefreshWatchCycleRequest } from '../src/shared/runtimeMessages';

describe('isRefreshWatchCycleRequest', () => {
  it('null / undefined では false を返す', () => {
    expect(isRefreshWatchCycleRequest(null)).toBe(false);
    expect(isRefreshWatchCycleRequest(undefined)).toBe(false);
  });

  it('非オブジェクト（文字列 / 数値）では false を返す', () => {
    expect(isRefreshWatchCycleRequest(REFRESH_WATCH_CYCLE_MESSAGE)).toBe(false);
    expect(isRefreshWatchCycleRequest(42)).toBe(false);
  });

  it('type プロパティが欠如したオブジェクトでは false を返す', () => {
    expect(isRefreshWatchCycleRequest({})).toBe(false);
    expect(isRefreshWatchCycleRequest({ payload: REFRESH_WATCH_CYCLE_MESSAGE })).toBe(false);
  });

  it('type が別の値のオブジェクトでは false を返す', () => {
    expect(isRefreshWatchCycleRequest({ type: 'other-message' })).toBe(false);
  });

  it('type === REFRESH_WATCH_CYCLE_MESSAGE を持つオブジェクトでは true を返す', () => {
    expect(isRefreshWatchCycleRequest({ type: REFRESH_WATCH_CYCLE_MESSAGE })).toBe(true);
  });
});
