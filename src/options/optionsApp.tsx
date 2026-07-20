import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { COLORS } from '../shared/colors';
import { clearEncryptedPat, hasReadablePat, saveEncryptedPat } from '../shared/patStorage';
import type { WatchTargetRepo } from '../shared/repositories';
import RepositoryDialog from './RepositoryDialog';
import { primaryButtonStyle, secondaryButtonStyle } from './buttonStyles';

type SettingsForm = {
  pat: string;
  repos: WatchTargetRepo[];
  intervalMinutes: number;
  notifyDraftPr: boolean;
};

const DEFAULT_INTERVAL_MINUTES = 5;

/** 説明文の共通スタイル */
const descriptionStyle: React.CSSProperties = { margin: '4px 0', color: COLORS.fgNeutral };

/**
 * ISO8601 文字列を options 画面表示用の日時文字列へ整形する。
 * @param value local storage に保存された `lastCheckedAt`
 * @returns `YYYY/MM/DD HH:mm:ss` 形式、または null
 */
function formatLastCheckedAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
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
 * - 監視対象リポジトリ設定を sync storage から読み込む
 */
const OptionsApp: React.FC = () => {
  const { t } = useTranslation();
  const [form, setForm] = useState<SettingsForm>({
    pat: '',
    repos: [],
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    notifyDraftPr: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasSavedPat, setHasSavedPat] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [isResettingLastCheckedAt, setIsResettingLastCheckedAt] = useState(false);
  const [isRepositoryDialogOpen, setIsRepositoryDialogOpen] = useState(false);

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
        notifyDraftPr: true,
      },
      (items: { repos?: unknown; intervalMinutes?: unknown; notifyDraftPr?: unknown }) => {
        const repos = Array.isArray(items.repos) ? (items.repos as WatchTargetRepo[]) : [];
        setForm({
          pat: '',
          repos,
          intervalMinutes: Number(items.intervalMinutes) || DEFAULT_INTERVAL_MINUTES,
          notifyDraftPr: items.notifyDraftPr === undefined ? true : Boolean(items.notifyDraftPr),
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
   * 設定フォームの送信ハンドラ。
   *
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
        await new Promise<void>((resolve) => {
          chrome.storage.sync.set(
            {
              repos: form.repos,
              intervalMinutes: form.intervalMinutes,
              notifyDraftPr: form.notifyDraftPr,
            },
            () => resolve(),
          );
        });

        if (form.pat.trim().length > 0) {
          await saveEncryptedPat(form.pat.trim());
        }

        setHasSavedPat(await loadPatStatus());
        setForm((prev) => ({ ...prev, pat: '' }));
        setSaveMessage(t('save.success'));
        setTimeout(() => setSaveMessage(null), 2000);
      } catch (error) {
        console.error('保存に失敗しました:', error);
        setSaveError(t('save.error'));
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
        setSaveMessage(t('pat.deleteSuccess'));
        setTimeout(() => setSaveMessage(null), 2000);
      } catch (error) {
        console.error('PAT の削除に失敗しました:', error);
        setSaveError(t('pat.deleteError'));
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
      <h1 style={{ fontSize: '18px', marginBottom: '12px' }}>{t('appTitle')}</h1>
      <form onSubmit={handleSubmit}>
        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>{t('pat.heading')}</h2>
          <p style={descriptionStyle}>{t('pat.description1')}</p>
          <p style={descriptionStyle}>{t('pat.description2')}</p>
          <p style={descriptionStyle}>{t('pat.description3')}</p>
          <p style={{ margin: '4px 0', color: hasSavedPat ? COLORS.success : COLORS.fgMuted }}>
            {t('pat.status', {
              status: hasSavedPat ? t('pat.statusConfigured') : t('pat.statusNotConfigured'),
            })}
          </p>
          <input
            type="password"
            value={form.pat}
            onChange={(e) => handleChange({ pat: e.target.value })}
            style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
            placeholder={hasSavedPat ? t('pat.placeholderChange') : t('pat.placeholderEnter')}
          />
          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              onClick={handleClearPat}
              disabled={isSaving || !hasSavedPat}
              style={{ ...secondaryButtonStyle, cursor: hasSavedPat ? 'pointer' : 'not-allowed' }}
            >
              {t('pat.clearButton')}
            </button>
          </div>
        </section>

        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>{t('notifySettings.heading')}</h2>
          <label>
            <input
              type="checkbox"
              checked={form.notifyDraftPr}
              onChange={(e) => handleChange({ notifyDraftPr: e.target.checked })}
            />{' '}
            {t('notifySettings.draftLabel')}
          </label>
          <p style={descriptionStyle}>{t('notifySettings.draftDescription')}</p>
        </section>

        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>{t('repos.heading')}</h2>
          <p style={descriptionStyle}>{t('repos.description')}</p>
          <button
            type="button"
            onClick={() => setIsRepositoryDialogOpen(true)}
            style={{ ...secondaryButtonStyle, cursor: 'pointer' }}
          >
            {t('repos.settingsButton')}
          </button>
          <div
            aria-label={t('repos.listAriaLabel')}
            style={{ whiteSpace: 'pre-line', marginTop: '8px', minHeight: '20px' }}
          >
            {form.repos.map((repo) => `${repo.owner}/${repo.name}`).join('\n')}
          </div>
        </section>

        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>{t('interval.heading')}</h2>
          <p style={descriptionStyle}>{t('interval.description')}</p>
          <input
            type="number"
            min={1}
            value={form.intervalMinutes}
            onChange={(e) => handleChange({ intervalMinutes: Number(e.target.value) || 1 })}
            style={{ width: '80px', padding: '4px' }}
          />{' '}
          {t('interval.unit')}
        </section>

        <section style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', margin: '8px 0' }}>{t('lastChecked.heading')}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span aria-label="lastCheckedAt">{formatLastCheckedAt(lastCheckedAt) ?? t('lastChecked.unset')}</span>
            <button
              type="button"
              onClick={handleResetLastCheckedAt}
              disabled={isSaving || isResettingLastCheckedAt}
              style={{
                ...secondaryButtonStyle,
                cursor: isSaving || isResettingLastCheckedAt ? 'default' : 'pointer',
              }}
            >
              {isResettingLastCheckedAt ? t('lastChecked.resetting') : t('lastChecked.reset')}
            </button>
          </div>
        </section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button type="submit" disabled={isSaving} style={primaryButtonStyle}>
            {isSaving ? t('save.saving') : t('save.submit')}
          </button>
          {saveMessage && <span style={{ color: COLORS.success }}>{saveMessage}</span>}
          {saveError && <span style={{ color: COLORS.danger }}>{saveError}</span>}
        </div>
      </form>
      {isRepositoryDialogOpen && (
        <RepositoryDialog
          repos={form.repos}
          onOk={(repos) => {
            handleChange({ repos });
            setIsRepositoryDialogOpen(false);
          }}
          onCancel={() => setIsRepositoryDialogOpen(false)}
        />
      )}
    </div>
  );
};

export default OptionsApp;
