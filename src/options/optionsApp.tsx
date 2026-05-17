import React, { useEffect, useState } from 'react';

import { clearEncryptedPat, hasReadablePat, saveEncryptedPat } from '../shared/patStorage';

type WatchTargetRepo = {
  owner: string;
  name: string;
};

type SettingsForm = {
  pat: string;
  reposText: string;
  intervalMinutes: number;
};

const DEFAULT_INTERVAL_MINUTES = 5;

/**
 * ISO8601 文字列を options 画面表示用の日時文字列へ整形する。
 * @param value local storage に保存された `lastCheckedAt`
 * @returns `YYYY/MM/DD HH:mm:ss` 形式、または未設定表示
 */
function formatLastCheckedAt(value: string | null): string {
  if (!value) {
    return '未設定';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未設定';
  }

  const pad = (part: number) => String(part).padStart(2, '0');
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('/') +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * オプションページのルートコンポーネント。
 *
 * - sync storage から通常設定を読み込みフォームへ反映
 * - PAT は local storage へ暗号化して保存
 * - 監視対象リポジトリの owner/repo 形式テキストを配列に変換
 */
const OptionsApp: React.FC = () => {
  const [form, setForm] = useState<SettingsForm>({
    pat: '',
    reposText: '',
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasSavedPat, setHasSavedPat] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [isResettingLastCheckedAt, setIsResettingLastCheckedAt] = useState(false);

  const loadPatStatus = () => hasReadablePat();

  /**
   * local storage から最終チェック日時を読み込む。
   * @returns 保存済み `lastCheckedAt`
   */
  const loadLastCheckedAt = () =>
    new Promise<string | null>((resolve) => {
      chrome.storage.local.get({ lastCheckedAt: null }, (items: { lastCheckedAt?: unknown }) => {
        resolve(typeof items.lastCheckedAt === 'string' ? items.lastCheckedAt : null);
      });
    });

  useEffect(() => {
    let isActive = true;

    void loadPatStatus().then((status) => {
      if (isActive) {
        setHasSavedPat(status);
      }
    });

    void loadLastCheckedAt().then((value) => {
      if (isActive) {
        setLastCheckedAt(value);
      }
    });

    chrome.storage.sync.get(
      {
        repos: [],
        intervalMinutes: DEFAULT_INTERVAL_MINUTES,
      },
      (items: any) => {
        const repos = Array.isArray(items.repos) ? (items.repos as WatchTargetRepo[]) : [];
        const reposText = repos.map((r) => `${r.owner}/${r.name}`).join('\n');
        setForm({
          pat: '',
          reposText,
          intervalMinutes: Number(items.intervalMinutes) || DEFAULT_INTERVAL_MINUTES,
        });
      },
    );

    return () => {
      isActive = false;
    };
  }, []);

  /**
   * フォーム状態を部分的に更新する。
   * @param patch 変更したいフィールドだけを含むパッチ
   */
  const handleChange = (patch: Partial<SettingsForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  /**
   * テキストエリアの内容から監視対象リポジトリ一覧を解析する。
   *
   * 各行は `owner/repo` 形式を想定し、不正な行は無視する。
   * @param text 入力テキスト
   * @returns 監視対象リポジトリ配列
   */
  const parseRepos = (text: string): WatchTargetRepo[] => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const result: WatchTargetRepo[] = [];
    for (const line of lines) {
      const [owner, name] = line.split('/');
      if (!owner || !name) continue;
      result.push({ owner, name });
    }
    return result;
  };

  /**
   * 設定フォームの送信ハンドラ。
   *
   * - テキストからリポジトリ一覧を解析
   * - 通常設定を sync storage に保存
   * - 入力された PAT があれば暗号化して local storage に保存
   * - 保存完了メッセージを一時的に表示
   */
  const handleSubmit: React.FormEventHandler = (e) => {
    e.preventDefault();
    void (async () => {
      setIsSaving(true);
      setSaveMessage(null);
      setSaveError(null);
      try {
        const repos = parseRepos(form.reposText);

        await new Promise<void>((resolve) => {
          chrome.storage.sync.set(
            {
              repos,
              intervalMinutes: form.intervalMinutes,
            },
            () => resolve(),
          );
        });

        if (form.pat.trim().length > 0) {
          await saveEncryptedPat(form.pat.trim());
        }

        setHasSavedPat(await loadPatStatus());
        setForm((prev) => ({ ...prev, pat: '' }));
        setSaveMessage('保存しました');
        setTimeout(() => setSaveMessage(null), 2000);
      } catch (error) {
        console.error('保存に失敗しました:', error);
        setSaveError('保存に失敗しました');
        setTimeout(() => setSaveError(null), 4000);
      } finally {
        setIsSaving(false);
      }
    })();
  };

  const handleClearPat = () => {
    void (async () => {
      setIsSaving(true);
      setSaveMessage(null);
      setSaveError(null);
      try {
        await clearEncryptedPat();
        setHasSavedPat(await loadPatStatus());
        setForm((prev) => ({ ...prev, pat: '' }));
        setSaveMessage('PAT を削除しました');
        setTimeout(() => setSaveMessage(null), 2000);
      } catch (error) {
        console.error('PAT の削除に失敗しました:', error);
        setSaveError('PAT の削除に失敗しました');
        setTimeout(() => setSaveError(null), 4000);
      } finally {
        setIsSaving(false);
      }
    })();
  };

  /**
   * 保存済みの最終チェック日時をクリアする。
   */
  const handleResetLastCheckedAt = () => {
    void (async () => {
      setIsResettingLastCheckedAt(true);
      try {
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ lastCheckedAt: null }, () => resolve());
        });
        setLastCheckedAt(null);
      } finally {
        setIsResettingLastCheckedAt(false);
      }
    })();
  };

  return (
    <div
      style={{
        maxWidth: '640px',
        margin: '0 auto',
        padding: '16px',
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: '13px',
      }}
    >
      <h1 style={{ fontSize: '18px', marginBottom: '12px' }}>GitHub Notify 設定</h1>
      <form onSubmit={handleSubmit}>
        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>API キー (PAT)</h2>
          <p style={{ margin: '4px 0', color: '#555' }}>
            GitHub Personal Access Token を入力してください。fine-grained PAT を推奨します。
          </p>
          <p style={{ margin: '4px 0', color: '#555' }}>
            対象リポジトリは監視したいリポジトリだけに絞り、権限は `Metadata: Read-only`、 `Issues:
            Read-only`、`Pull requests: Read-only` のみにしてください。
          </p>
          <p style={{ margin: '4px 0', color: '#555' }}>
            `Contents` の write、`Administration`、`Actions`、`Webhooks` など、この拡張で使わない
            権限は付与しないでください。
          </p>
          <p style={{ margin: '4px 0', color: hasSavedPat ? '#1a7f37' : '#57606a' }}>
            現在の状態: {hasSavedPat ? 'PAT 設定済み' : 'PAT 未設定'}
          </p>
          <input
            type="password"
            value={form.pat}
            onChange={(e) => handleChange({ pat: e.target.value })}
            style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
            placeholder={hasSavedPat ? '変更する場合のみ新しい PAT を入力' : 'PAT を入力'}
          />
          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              onClick={handleClearPat}
              disabled={isSaving || !hasSavedPat}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #d0d7de',
                backgroundColor: '#fff',
                color: '#24292f',
                cursor: hasSavedPat ? 'pointer' : 'not-allowed',
              }}
            >
              保存済み PAT を削除
            </button>
          </div>
        </section>

        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>監視対象リポジトリ</h2>
          <p style={{ margin: '4px 0', color: '#555' }}>
            1 行に 1 リポジトリずつ、<code>owner/repo</code> 形式で入力してください。
          </p>
          <textarea
            value={form.reposText}
            onChange={(e) => handleChange({ reposText: e.target.value })}
            rows={6}
            style={{ width: '100%', padding: '6px', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </section>

        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>監視間隔</h2>
          <p style={{ margin: '4px 0', color: '#555' }}>通知の検出間隔を分単位で指定します。</p>
          <input
            type="number"
            min={1}
            value={form.intervalMinutes}
            onChange={(e) => handleChange({ intervalMinutes: Number(e.target.value) || 1 })}
            style={{ width: '80px', padding: '4px' }}
          />{' '}
          分
        </section>

        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>最終チェック日</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span aria-label="lastCheckedAt">{formatLastCheckedAt(lastCheckedAt)}</span>
            <button
              type="button"
              onClick={handleResetLastCheckedAt}
              disabled={isSaving || isResettingLastCheckedAt}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #d0d7de',
                backgroundColor: '#fff',
                color: '#24292f',
                cursor: isSaving || isResettingLastCheckedAt ? 'default' : 'pointer',
              }}
            >
              {isResettingLastCheckedAt ? 'リセット中...' : 'リセット'}
            </button>
          </div>
        </section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="submit"
            disabled={isSaving}
            style={{
              padding: '6px 16px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#0969da',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
          {saveMessage && <span style={{ color: '#1a7f37' }}>{saveMessage}</span>}
          {saveError && <span style={{ color: '#cf222e' }}>{saveError}</span>}
        </div>
      </form>
    </div>
  );
};

export default OptionsApp;
