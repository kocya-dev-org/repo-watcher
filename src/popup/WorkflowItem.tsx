import React from 'react';

import { COLORS } from '../shared/colors';
import { getMessage } from '../shared/i18n';
import { getWorkflowResultColor, type WorkflowRunResult } from '../shared/workflows';

type WorkflowItemProps = { run: WorkflowRunResult };

const WorkflowItem: React.FC<WorkflowItemProps> = ({ run }) => {
  const t = getMessage;
  const color = COLORS[getWorkflowResultColor(run.conclusion)];
  const label = run.conclusion === 'success' ? t('workflows.resultSuccess') : t('workflows.resultFailure');
  return (
    <div
      style={{
        padding: '6px 8px',
        borderBottom: `1px solid ${COLORS.borderSubtle}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <a
        href={run.workflowHtmlUrl}
        target="_blank"
        rel="noreferrer"
        style={{
          flex: 1,
          minWidth: 0,
          color: COLORS.accent,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {run.workflowName}
      </a>
      <a href={run.htmlUrl} target="_blank" rel="noreferrer" style={{ color, fontWeight: 600, flexShrink: 0 }}>
        {label}
      </a>
    </div>
  );
};

export default WorkflowItem;
