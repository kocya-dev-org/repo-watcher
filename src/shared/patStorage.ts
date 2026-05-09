import { decryptPat, encryptPat, type EncryptedPatPayload } from '../background/security';

export type StoredPatState = {
  encryptedPat: EncryptedPatPayload | null;
  patCurrentStartupAt: string | null;
  patPreviousStartupAt: string | null;
};

const PAT_STORAGE_DEFAULTS: StoredPatState = {
  encryptedPat: null,
  patCurrentStartupAt: null,
  patPreviousStartupAt: null,
};

/**
 * local storage から読んだ値が暗号化済み PAT payload か判定する。
 * @param value 判定対象の値
 * @returns payload の shape を満たす場合は true
 */
function isEncryptedPatPayload(value: unknown): value is EncryptedPatPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.ciphertext === 'string' &&
    typeof record.iv === 'string' &&
    typeof record.salt === 'string' &&
    typeof record.iterations === 'number' &&
    typeof record.encryptedAt === 'string'
  );
}

/**
 * PAT 関連の local storage 状態を読み込む。
 * @returns 保存済みの PAT 状態
 */
export function loadStoredPatState(): Promise<StoredPatState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(PAT_STORAGE_DEFAULTS, (items) => {
      resolve({
        encryptedPat: isEncryptedPatPayload(items.encryptedPat) ? items.encryptedPat : null,
        patCurrentStartupAt:
          typeof items.patCurrentStartupAt === 'string' ? items.patCurrentStartupAt : null,
        patPreviousStartupAt:
          typeof items.patPreviousStartupAt === 'string' ? items.patPreviousStartupAt : null,
      });
    });
  });
}

/**
 * PAT 関連の local storage 状態を更新する。
 * @param items 保存する差分
 */
export function saveStoredPatState(items: Partial<StoredPatState>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

/**
 * 現在起動分の基準時刻を返し、未保存なら生成して保存する。
 * @returns 現在起動分の時刻
 */
export async function ensurePatStartupTime(): Promise<string> {
  const state = await loadStoredPatState();
  if (state.patCurrentStartupAt) {
    return state.patCurrentStartupAt;
  }

  const startupAt = new Date().toISOString();
  await saveStoredPatState({ patCurrentStartupAt: startupAt });
  return startupAt;
}

/**
 * 平文 PAT を現在起動分の鍵で暗号化して保存する。
 * @param pat 保存する PAT
 */
export async function saveEncryptedPat(pat: string): Promise<void> {
  const startupAt = await ensurePatStartupTime();
  const encryptedPat = await encryptPat(pat, startupAt);
  await saveStoredPatState({ encryptedPat });
}

/**
 * 保存済み PAT を削除する。
 */
export async function clearEncryptedPat(): Promise<void> {
  await saveStoredPatState({ encryptedPat: null });
}

/**
 * 暗号化済み PAT が保存されているか判定する。
 * @returns 保存されていれば true
 */
export async function hasEncryptedPat(): Promise<boolean> {
  const state = await loadStoredPatState();
  return state.encryptedPat !== null;
}

/**
 * 保存済み PAT を現在または前回起動時刻で複号して返す。
 * @returns 複号できた PAT、失敗時は null
 */
export async function loadDecryptedPat(): Promise<string | null> {
  const state = await loadStoredPatState();
  if (!state.encryptedPat) {
    return null;
  }

  if (state.patCurrentStartupAt) {
    try {
      return await decryptPat(state.encryptedPat, state.patCurrentStartupAt);
    } catch {
      // 現在の起動時刻で複号できない場合のみ前回値を試す。
    }
  }

  if (state.patPreviousStartupAt) {
    try {
      const pat = await decryptPat(state.encryptedPat, state.patPreviousStartupAt);
      if (state.patCurrentStartupAt && state.patCurrentStartupAt !== state.patPreviousStartupAt) {
        const encryptedPat = await encryptPat(pat, state.patCurrentStartupAt);
        await saveStoredPatState({ encryptedPat });
      }
      return pat;
    } catch {
      // 前回の起動時刻でも複号できない場合は、保存されている PAT を破棄して再入力させる。
      await clearEncryptedPat();
      return null;
    }
  }

  await clearEncryptedPat();
  return null;
}

/**
 * 現在の保存状態から利用可能な PAT を取り出せるか判定する。
 * @returns 読み出せる PAT があれば true
 */
export async function hasReadablePat(): Promise<boolean> {
  const pat = await loadDecryptedPat();
  return pat !== null;
}

/**
 * 起動時に PAT を前回時刻で複号し、今回時刻で再暗号化して保存し直す。
 * @param startupAt 今回起動分として保存する時刻
 */
export async function rotateEncryptedPatForStartup(startupAt: string = new Date().toISOString()) {
  const state = await loadStoredPatState();
  const previousStartupAt = state.patCurrentStartupAt;

  if (!previousStartupAt) {
    await saveStoredPatState({ patCurrentStartupAt: startupAt });
    return;
  }

  if (!state.encryptedPat) {
    await saveStoredPatState({
      patPreviousStartupAt: previousStartupAt,
      patCurrentStartupAt: startupAt,
    });
    return;
  }

  const pat = await decryptPat(state.encryptedPat, previousStartupAt);
  const encryptedPat = await encryptPat(pat, startupAt);
  await saveStoredPatState({
    encryptedPat,
    patPreviousStartupAt: previousStartupAt,
    patCurrentStartupAt: startupAt,
  });
}
