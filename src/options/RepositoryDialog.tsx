import React, { useState } from 'react';

import { DEFAULT_REPO_COLOR, type WatchTargetRepo } from '../shared/repositories';

type RepositoryDialogProps = {
  repos: WatchTargetRepo[];
  onOk: (repos: WatchTargetRepo[]) => void;
  onCancel: () => void;
};

const RepositoryDialog: React.FC<RepositoryDialogProps> = ({ repos, onOk, onCancel }) => {
  const [editableRepos, setEditableRepos] = useState<WatchTargetRepo[]>(() =>
    repos.map((repo) => ({ ...repo, color: repo.color ?? DEFAULT_REPO_COLOR })),
  );

  const updateRepo = (index: number, patch: Partial<WatchTargetRepo>) => {
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
          backgroundColor: '#fff',
          borderRadius: '6px',
          boxSizing: 'border-box',
        }}
      >
        <h2 id="repository-dialog-title" style={{ fontSize: '16px', margin: '0 0 12px' }}>
          リポジトリ設定
        </h2>
        {editableRepos.map((repo, index) => (
          <div
            key={index}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}
          >
            <input
              aria-label={`リポジトリ ${index + 1}`}
              type="text"
              value={repo.owner && repo.name ? `${repo.owner}/${repo.name}` : ''}
              onChange={(event) => {
                const [owner = '', ...nameParts] = event.target.value.split('/');
                updateRepo(index, { owner, name: nameParts.join('/') });
              }}
              placeholder="owner/repo"
              style={{ flex: 1, minWidth: 0, padding: '6px' }}
            />
            <input
              aria-label={`表示色 ${index + 1}`}
              type="color"
              value={repo.color ?? DEFAULT_REPO_COLOR}
              onChange={(event) => updateRepo(index, { color: event.target.value })}
            />
            <button type="button" onClick={() => deleteRepo(index)}>
              削除
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            type="button"
            onClick={() =>
              setEditableRepos((current) => [
                ...current,
                { owner: '', name: '', color: DEFAULT_REPO_COLOR },
              ])
            }
          >
            追加
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" onClick={() => onOk(editableRepos)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default RepositoryDialog;
