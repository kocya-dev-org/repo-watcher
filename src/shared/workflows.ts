/** GitHub Actions の監視対象ワークフロー。 */
export type WatchTargetWorkflow = {
  owner: string;
  name: string;
  workflowId: number;
  workflowName: string;
  path: string;
};

export type WorkflowConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'startup_failure'
  | 'stale'
  | null;

/** 監視対象ワークフローの最新実行結果。 */
export type WorkflowRunResult = {
  workflowId: number;
  workflowName: string;
  conclusion: WorkflowConclusion;
  status: string;
  htmlUrl: string;
  workflowHtmlUrl: string;
  owner: string;
  repo: string;
};

/** conclusion が失敗としてバッジに加算される状態か判定する。 */
export function isWorkflowFailure(conclusion: WorkflowConclusion): boolean {
  return (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'startup_failure' ||
    conclusion === 'action_required'
  );
}

export function getWorkflowResultColor(conclusion: WorkflowConclusion): 'success' | 'danger' {
  return conclusion === 'success' ? 'success' : 'danger';
}
