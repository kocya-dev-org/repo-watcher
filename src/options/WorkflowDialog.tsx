import React, { useEffect, useState } from 'react';

import { fetchRepositoryWorkflows } from '../shared/githubWorkflows';
import { COLORS } from '../shared/colors';
import { getMessage } from '../shared/i18n';
import { loadDecryptedPat } from '../shared/patStorage';
import type { WatchTargetRepo } from '../shared/repositories';
import type { WatchTargetWorkflow } from '../shared/workflows';
import { primaryButtonStyle, secondaryButtonStyle } from './buttonStyles';

type WorkflowDialogProps = {
  repos: WatchTargetRepo[];
  workflows: WatchTargetWorkflow[];
  onOk: (workflows: WatchTargetWorkflow[]) => void;
  onCancel: () => void;
};

const WorkflowDialog: React.FC<WorkflowDialogProps> = ({ repos, workflows, onOk, onCancel }) => {
  const t = getMessage;
  const [available, setAvailable] = useState<WatchTargetWorkflow[]>([]);
  const [selected, setSelected] = useState<WatchTargetWorkflow[]>(workflows);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const pat = await loadDecryptedPat();
        if (!pat) {
          if (active) setError(t('workflows.errorPat'));
          return;
        }
        const results = await Promise.all(repos.map((repo) => fetchRepositoryWorkflows(repo, pat)));
        if (active) {
          const availableWorkflows = results.flat();
          setAvailable(availableWorkflows);
          const availableKeys = new Set(
            availableWorkflows.map((workflow) => `${workflow.owner}/${workflow.name}/${workflow.workflowId}`),
          );
          setSelected((current) =>
            current.filter((workflow) =>
              availableKeys.has(`${workflow.owner}/${workflow.name}/${workflow.workflowId}`),
            ),
          );
        }
      } catch {
        if (active) setError(t('workflows.error'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [repos, t]);

  const toggle = (workflow: WatchTargetWorkflow) => {
    const key = `${workflow.owner}/${workflow.name}/${workflow.workflowId}`;
    setSelected((current) =>
      current.some((item) => `${item.owner}/${item.name}/${item.workflowId}` === key)
        ? current.filter((item) => `${item.owner}/${item.name}/${item.workflowId}` !== key)
        : [...current, workflow],
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="workflow-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        zIndex: 1300,
      }}
    >
      <div
        style={{
          width: 'min(560px, calc(100% - 32px))',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: 16,
          backgroundColor: COLORS.bgDefault,
          borderRadius: 6,
          boxSizing: 'border-box',
          fontSize: 13,
        }}
      >
        <h2 id="workflow-dialog-title" style={{ fontSize: 16, margin: '0 0 12px' }}>
          {t('workflows.dialogTitle')}
        </h2>
        {loading ? (
          <p>{t('workflows.loading')}</p>
        ) : error ? (
          <p role="alert" style={{ color: COLORS.danger }}>
            {error}
          </p>
        ) : available.length === 0 ? (
          <p>{t('workflows.empty')}</p>
        ) : (
          repos.map((repo) => {
            const repoWorkflows = available.filter(
              (workflow) => workflow.owner === repo.owner && workflow.name === repo.name,
            );
            if (repoWorkflows.length === 0) return null;
            return (
              <fieldset
                key={`${repo.owner}/${repo.name}`}
                style={{ border: `1px solid ${COLORS.border}`, margin: '8px 0', padding: 8 }}
              >
                <legend>
                  {repo.owner}/{repo.name}
                </legend>
                {repoWorkflows.map((workflow) => {
                  const checked = selected.some(
                    (item) =>
                      item.owner === workflow.owner &&
                      item.name === workflow.name &&
                      item.workflowId === workflow.workflowId,
                  );
                  return (
                    <label key={workflow.workflowId} style={{ display: 'block', padding: '3px 0' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(workflow)} />{' '}
                      {workflow.workflowName}
                    </label>
                  );
                })}
              </fieldset>
            );
          })
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            {t('workflows.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onOk(selected)}
            disabled={loading || Boolean(error)}
            style={primaryButtonStyle}
          >
            {t('workflows.ok')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowDialog;
