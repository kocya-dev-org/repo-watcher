import { beforeEach, describe, expect, it, vi } from 'vitest';

const graphqlMocks = vi.hoisted(() => ({
  client: vi.fn(),
  defaults: vi.fn(),
}));

vi.mock('@octokit/graphql', () => ({
  graphql: {
    defaults: graphqlMocks.defaults,
  },
}));

async function importGraphqlSmokeTool() {
  return import('../tools/graphql-smoke.js');
}

describe('graphql smoke tool', () => {
  beforeEach(() => {
    vi.resetModules();
    graphqlMocks.client.mockReset();
    graphqlMocks.defaults.mockReset();
    graphqlMocks.defaults.mockReturnValue(graphqlMocks.client);
  });

  it('parseCliArgs は --authorization を受け取れる', async () => {
    const { parseCliArgs } = await importGraphqlSmokeTool();

    expect(parseCliArgs(['--authorization', 'token github_pat_test'])).toEqual({
      authorization: 'token github_pat_test',
      help: false,
    });
    expect(parseCliArgs(['--authorization=Bearer test-token'])).toEqual({
      authorization: 'Bearer test-token',
      help: false,
    });
    expect(parseCliArgs(['--', '--authorization', 'token github_pat_test'])).toEqual({
      authorization: 'token github_pat_test',
      help: false,
    });
  });

  it('main は Authorization 未指定時に usage を出して失敗する', async () => {
    const { main, USAGE } = await importGraphqlSmokeTool();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await main([], {
      stdout: (text) => void stdout.push(text),
      stderr: (text) => void stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('--authorization は必須です。');
    expect(stderr.join('')).toContain(USAGE);
  });

  it('main は固定クエリを実行して整形済み JSON を出力する', async () => {
    const { DEFAULT_QUERY, main } = await importGraphqlSmokeTool();
    const stdout: string[] = [];
    const stderr: string[] = [];

    graphqlMocks.client.mockResolvedValue({
      viewer: {
        login: 'octocat',
      },
    });

    const exitCode = await main(['--authorization', 'token github_pat_test'], {
      stdout: (text) => void stdout.push(text),
      stderr: (text) => void stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(graphqlMocks.defaults).toHaveBeenCalledWith({
      headers: {
        authorization: 'token github_pat_test',
      },
    });
    expect(graphqlMocks.client).toHaveBeenCalledWith(DEFAULT_QUERY);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toContain('"login": "octocat"');
  });

  it('main はエラー出力で Authorization を伏せる', async () => {
    const { main } = await importGraphqlSmokeTool();
    const stderr: string[] = [];

    graphqlMocks.client.mockRejectedValue(
      new Error('authorization: token github_pat_test failed'),
    );

    const exitCode = await main(['--authorization', 'token github_pat_test'], {
      stdout: () => undefined,
      stderr: (text) => void stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('authorization: [REDACTED] failed');
    expect(stderr.join('')).not.toContain('github_pat_test');
  });
});
