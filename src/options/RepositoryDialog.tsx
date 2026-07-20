import React, { useState } from 'react';

import { COLORS } from '../shared/colors';
import { DEFAULT_REPO_COLOR, type WatchTargetRepo } from '../shared/repositories';
import { primaryButtonStyle, secondaryButtonStyle } from './buttonStyles';

type RepositoryDialogProps = {
  repos: WatchTargetRepo[];
  onOk: (repos: WatchTargetRepo[]) => void;
  onCancel: () => void;
};

type EditableRepository = {
  text: string;
  color: string;
};

/** `#rrggbb` 形式のランダムな HEX カラー文字列を返す。 */
const generateRandomColor = (): string =>
  `#${Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .padStart(6, '0')}`;

const RepositoryDialog: React.FC<RepositoryDialogProps> = ({ repos, onOk, onCancel }) => {
  const [editableRepos, setEditableRepos] = useState<EditableRepository[]>(() =>
    repos.map((repo) => ({
      text: `${repo.owner}/${repo.name}`,
      color: repo.color ?? DEFAULT_REPO_COLOR,
    })),
  );

  const updateRepo = (index: number, patch: Partial<EditableRepository>) => {
    setEditableRepos((current) =>
      current.map((repo, repoIndex) => (repoIndex === index ? { ...repo, ...patch } : repo)),
    );
  };

  const deleteRepo = (index: number) => {
    setEditableRepos((current) => current.filter((_, repoIndex) => repoIndex !== index));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="repository-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
      }}
    >
      <div
        style={{
          width: 'min(560px, calc(100% - 32px))',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: '16px',
          backgroundColor: COLORS.bgDefault,
          borderRadius: '6px',
          boxSizing: 'border-box',
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: '13px',
        }}
      >
        <h2 id="repository-dialog-title" style={{ fontSize: '16px', margin: '0 0 12px' }}>
          リポジトリ設定
        </h2>
        {editableRepos.map((repo, index) => (
          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <input
              aria-label={`リポジトリ ${index + 1}`}
              type="text"
              value={repo.text}
              onChange={(event) => updateRepo(index, { text: event.target.value })}
              placeholder="owner/repo"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '6px',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '4px',
                boxSizing: 'border-box',
              }}
            />
            <input
              aria-label={`表示色 ${index + 1}`}
              type="color"
              value={repo.color ?? DEFAULT_REPO_COLOR}
              onChange={(event) => updateRepo(index, { color: event.target.value })}
            />
            <button
              type="button"
              onClick={() => deleteRepo(index)}
              style={{ ...secondaryButtonStyle, cursor: 'pointer' }}
            >
              削除
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            type="button"
            onClick={() => setEditableRepos((current) => [...current, { text: '', color: generateRandomColor() }])}
            style={{ ...secondaryButtonStyle, cursor: 'pointer' }}
          >
            追加
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onCancel} style={{ ...secondaryButtonStyle, cursor: 'pointer' }}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              const validRepos = editableRepos.flatMap((repo) => {
                const [owner = '', ...nameParts] = repo.text.trim().split('/');
                const name = nameParts.join('/');
                return owner && name ? [{ owner, name, color: repo.color }] : [];
              });
              onOk(validRepos);
            }}
            style={primaryButtonStyle}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default RepositoryDialog;
