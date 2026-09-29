import type { WatchTargetWorkflow, WorkflowRunResult } from './workflows';
import type { WatchTargetRepo } from './repositories';

type GitHubWorkflow = { id: number; name: string; path: string };
type GitHubWorkflowRun = { conclusion: WorkflowRunResult['conclusion']; status: string; html_url: string };

async function githubGet<T>(path: string, pat: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `bearer ${pat}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchRepositoryWorkflows(repo: WatchTargetRepo, pat: string): Promise<WatchTargetWorkflow[]> {
  const result = await githubGet<{ workflows: GitHubWorkflow[] }>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/workflows?per_page=100`,
    pat,
  );
  return (result.workflows ?? []).map((workflow) => ({
    owner: repo.owner,
    name: repo.name,
    workflowId: workflow.id,
    workflowName: workflow.name,
    path: workflow.path,
  }));
}

export async function fetchLatestWorkflowRun(
  workflow: WatchTargetWorkflow,
  pat: string,
): Promise<WorkflowRunResult | null> {
  const result = await githubGet<{ workflow_runs: GitHubWorkflowRun[] }>(
    `/repos/${encodeURIComponent(workflow.owner)}/${encodeURIComponent(workflow.name)}/actions/workflows/${workflow.workflowId}/runs?per_page=1`,
    pat,
  );
  const run = result.workflow_runs?.[0];
  if (!run) return null;
  const workflowPath = workflow.path.replace(/^\.github\/workflows\//, '');
  return {
    workflowId: workflow.workflowId,
    workflowName: workflow.workflowName,
    conclusion: run.conclusion,
    status: run.status,
    htmlUrl: run.html_url,
    workflowHtmlUrl: `https://github.com/${encodeURIComponent(workflow.owner)}/${encodeURIComponent(workflow.name)}/actions/workflows/${workflowPath}`,
    owner: workflow.owner,
    repo: workflow.name,
  };
}
