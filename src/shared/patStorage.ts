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

export function saveStoredPatState(items: Partial<StoredPatState>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

export async function ensurePatStartupTime(): Promise<string> {
  const state = await loadStoredPatState();
  if (state.patCurrentStartupAt) {
    return state.patCurrentStartupAt;
  }

  const startupAt = new Date().toISOString();
  await saveStoredPatState({ patCurrentStartupAt: startupAt });
  return startupAt;
}

export async function saveEncryptedPat(pat: string): Promise<void> {
  const startupAt = await ensurePatStartupTime();
  const encryptedPat = await encryptPat(pat, startupAt);
  await saveStoredPatState({ encryptedPat });
}

export async function clearEncryptedPat(): Promise<void> {
  await saveStoredPatState({ encryptedPat: null });
}

export async function hasEncryptedPat(): Promise<boolean> {
  const state = await loadStoredPatState();
  return state.encryptedPat !== null;
}

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

  return null;
}

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
