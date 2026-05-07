export const REFRESH_WATCH_CYCLE_MESSAGE = 'refresh-watch-cycle';

export type RefreshWatchCycleRequest = {
  type: typeof REFRESH_WATCH_CYCLE_MESSAGE;
};

export type RefreshWatchCycleResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      errorMessage: string;
    };

export function isRefreshWatchCycleRequest(
  value: unknown,
): value is RefreshWatchCycleRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    'type' in value &&
    (value as RefreshWatchCycleRequest).type === REFRESH_WATCH_CYCLE_MESSAGE
  );
}
