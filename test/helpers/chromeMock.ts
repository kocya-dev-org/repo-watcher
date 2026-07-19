import { vi } from 'vitest';

type StorageAreaName = 'local' | 'sync';
type StorageChanges = Record<string, { oldValue: unknown; newValue: unknown }>;
type StorageState = Record<string, unknown>;

type AlarmListener = (alarm: { name: string }) => void;
type EmptyListener = () => void;
type StorageChangeListener = (changes: StorageChanges, areaName: StorageAreaName) => void;
type NotificationClickListener = (notificationId: string) => void;
type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function resolveStorageGet(query: unknown, state: StorageState): unknown {
  if (query === null || query === undefined) {
    return cloneValue(state);
  }

  if (typeof query === 'string') {
    return { [query]: cloneValue(state[query]) };
  }

  if (Array.isArray(query)) {
    return Object.fromEntries(query.map((key) => [key, cloneValue(state[key])]));
  }

  if (typeof query === 'object') {
    return Object.fromEntries(
      Object.entries(query as Record<string, unknown>).map(([key, fallback]) => [
        key,
        key in state ? cloneValue(state[key]) : cloneValue(fallback),
      ]),
    );
  }

  return {};
}

function buildChanges(items: StorageState, state: StorageState): StorageChanges {
  return Object.fromEntries(
    Object.entries(items).map(([key, value]) => [
      key,
      {
        oldValue: cloneValue(state[key]),
        newValue: cloneValue(value),
      },
    ]),
  );
}

export type ChromeMockController = ReturnType<typeof createChromeMock>;

export function createChromeMock(initial?: { local?: StorageState; sync?: StorageState }) {
  const alarmsListeners: AlarmListener[] = [];
  const runtimeInstalledListeners: EmptyListener[] = [];
  const runtimeStartupListeners: EmptyListener[] = [];
  const storageChangedListeners: StorageChangeListener[] = [];
  const notificationClickedListeners: NotificationClickListener[] = [];
  const runtimeMessageListeners: RuntimeMessageListener[] = [];

  const localState: StorageState = { ...(initial?.local ?? {}) };
  const syncState: StorageState = { ...(initial?.sync ?? {}) };

  const emitStorageChange = (changes: StorageChanges, areaName: StorageAreaName) => {
    for (const listener of storageChangedListeners) {
      listener(changes, areaName);
    }
  };

  const createStorageArea = (areaName: StorageAreaName, state: StorageState) => ({
    get: vi.fn((query: unknown, callback: (items: unknown) => void) => {
      callback(resolveStorageGet(query, state));
    }),
    set: vi.fn((items: StorageState, callback?: () => void) => {
      const changes = buildChanges(items, state);
      Object.assign(state, cloneValue(items));
      callback?.();
      emitStorageChange(changes, areaName);
    }),
  });

  const chromeMock = {
    storage: {
      local: createStorageArea('local', localState),
      sync: createStorageArea('sync', syncState),
      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => {
          storageChangedListeners.push(listener);
        }),
      },
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    tabs: {
      create: vi.fn(),
    },
    alarms: {
      clear: vi.fn((name: string, callback?: () => void) => {
        callback?.();
      }),
      create: vi.fn(),
      onAlarm: {
        addListener: vi.fn((listener: AlarmListener) => {
          alarmsListeners.push(listener);
        }),
      },
    },
    notifications: {
      create: vi.fn((notificationId: string, options: unknown, callback?: () => void) => {
        callback?.();
      }),
      clear: vi.fn((notificationId: string, callback?: (wasCleared: boolean) => void) => {
        callback?.(true);
      }),
      onClicked: {
        addListener: vi.fn((listener: NotificationClickListener) => {
          notificationClickedListeners.push(listener);
        }),
      },
    },
    runtime: {
      lastError: undefined as { message: string } | undefined,
      getManifest: vi.fn(() => ({ version: '1.0.0' })),
      openOptionsPage: vi.fn(),
      sendMessage: vi.fn((message: unknown, callback?: (response: unknown) => void) => {
        let responded = false;
        let handledAsync = false;
        chromeMock.runtime.lastError = undefined;

        const sendResponse = (response: unknown) => {
          responded = true;
          callback?.(response);
        };

        for (const listener of runtimeMessageListeners) {
          const listenerResult = listener(message, {}, sendResponse);
          if (listenerResult === true) {
            handledAsync = true;
          }
          if (responded) {
            break;
          }
        }

        if (!responded && !handledAsync) {
          callback?.(undefined);
        }
      }),
      onInstalled: {
        addListener: vi.fn((listener: EmptyListener) => {
          runtimeInstalledListeners.push(listener);
        }),
      },
      onStartup: {
        addListener: vi.fn((listener: EmptyListener) => {
          runtimeStartupListeners.push(listener);
        }),
      },
      onMessage: {
        addListener: vi.fn((listener: RuntimeMessageListener) => {
          runtimeMessageListeners.push(listener);
        }),
      },
    },
  } as const;

  return {
    chrome: chromeMock,
    getLocalState: () => cloneValue(localState),
    getSyncState: () => cloneValue(syncState),
    setLocalState: (nextState: StorageState) => {
      Object.keys(localState).forEach((key) => {
        delete localState[key];
      });
      Object.assign(localState, cloneValue(nextState));
    },
    setSyncState: (nextState: StorageState) => {
      Object.keys(syncState).forEach((key) => {
        delete syncState[key];
      });
      Object.assign(syncState, cloneValue(nextState));
    },
    triggerAlarm: (name: string) => {
      for (const listener of alarmsListeners) {
        listener({ name });
      }
    },
    triggerInstalled: () => {
      for (const listener of runtimeInstalledListeners) {
        listener();
      }
    },
    triggerStartup: () => {
      for (const listener of runtimeStartupListeners) {
        listener();
      }
    },
    triggerNotificationClicked: (notificationId: string) => {
      for (const listener of notificationClickedListeners) {
        listener(notificationId);
      }
    },
    triggerStorageChanged: (changes: StorageChanges, areaName: StorageAreaName) => {
      emitStorageChange(changes, areaName);
    },
  };
}
