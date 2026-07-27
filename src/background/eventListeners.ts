import { rotateEncryptedPatForStartup } from '../shared/patStorage';
import { isRefreshWatchCycleRequest, type RefreshWatchCycleResponse } from '../shared/runtimeMessages';
import { debugLog } from './logging';
import { loadLocalRuntimeStorage, saveLocalRuntimeStorage } from './runtimeStorage';
import { sanitizeError } from './security';
import {
  isScheduledWatchPaused,
  restoreBadge,
  runWatchCycleOnce,
  setupAlarms,
  toErrorMessage,
  WATCH_ALARM_NAME,
} from './watchCycle';

/**
 * background service worker が購読する Chrome イベントをまとめて登録する。
 *
 * 検知ロジック本体 (`watchCycle`) と Chrome API の副作用をこのモジュールへ分離している。
 */
export function registerEventListeners() {
  // 拡張機能インストール時にアラームを初期化
  chrome.runtime.onInstalled.addListener(() => {
    setupAlarms();
  });

  // ブラウザ起動時に PAT を前回起動時刻で複号し、今回起動時刻で再暗号化する
  chrome.runtime.onStartup.addListener(() => {
    void rotateEncryptedPatForStartup().catch((err) => {
      console.error('pat rotation failed', sanitizeError(err));
    });
  });

  // 設定変更時にアラームや viewer キャッシュを再評価する
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') {
      return;
    }

    if (changes.intervalMinutes || changes.repos || changes.isWatchPaused) {
      setupAlarms();
    }
    if (changes.notifyDraftPr) {
      void restoreBadge();
    }
  });

  // アラーム発火時に監視サイクルを実行する
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== WATCH_ALARM_NAME) {
      return;
    }

    void isScheduledWatchPaused()
      .then((paused) => {
        if (paused) {
          debugLog('watch cycle skipped: scheduled watch is paused');
          return;
        }

        return runWatchCycleOnce();
      })
      .catch((err) => {
        console.error('watch cycle failed', JSON.stringify(sanitizeError(err), null, 2));
      });
  });

  // popup からの手動更新要求で監視サイクルを実行する
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRefreshWatchCycleRequest(message)) {
      return;
    }

    debugLog('manual watch cycle requested');
    void runWatchCycleOnce()
      .then((result) => {
        const response: RefreshWatchCycleResponse =
          result.status === 'completed' || result.status === 'paused'
            ? { ok: true }
            : {
                ok: false,
                errorMessage: result.errorMessage,
              };
        sendResponse(response);
      })
      .catch((err) => {
        console.error('manual watch cycle failed', sanitizeError(err));
        const response: RefreshWatchCycleResponse = {
          ok: false,
          errorMessage: toErrorMessage(err),
        };
        sendResponse(response);
      });

    return true;
  });

  // OS 通知クリック時に対象の PR / Issue を開く
  chrome.notifications.onClicked.addListener((notificationId) => {
    void (async () => {
      // クリック対象の削除は最新の対応表に対して行う必要があるため、ここで読み直す
      const localState = await loadLocalRuntimeStorage();
      const url = localState.notificationClickTargets[notificationId];
      if (url) {
        chrome.tabs.create({ url });
      }

      const nextTargets = { ...localState.notificationClickTargets };
      delete nextTargets[notificationId];
      await saveLocalRuntimeStorage({ notificationClickTargets: nextTargets });
      chrome.notifications.clear(notificationId);
    })();
  });
}
