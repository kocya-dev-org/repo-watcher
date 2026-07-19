#!/usr/bin/env node

import { graphql } from '@octokit/graphql';
import { fileURLToPath } from 'node:url';

export const DEFAULT_QUERY = `query {
  viewer {
    login
    bio
  }
}`;
// パラメータ。ORや括弧は認識されない
export const DEFAULT_OPTIONS = `{
/*
e.g.
  repoQuery:
    'repo:{repo_name} is:pr is:open updated:>{date time} assignee:{name}',
*/
}`;

export const USAGE = `Usage:
  node .\\tools\\graphql-smoke.js --authorization "token <YOUR_PAT>"
  npm run tool-graphql -- -- --authorization "token <YOUR_PAT>"

Options:
  --authorization <value>  GraphQL request に使う Authorization ヘッダ
  --help                   このヘルプを表示
`;

function consumeOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${optionName} の値を指定してください。`);
  }

  return value;
}

export function parseCliArgs(argv) {
  let authorization = null;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--authorization') {
      authorization = consumeOptionValue(argv, index, '--authorization');
      index += 1;
      continue;
    }

    if (arg.startsWith('--authorization=')) {
      authorization = arg.slice('--authorization='.length);
      if (!authorization) {
        throw new Error('--authorization の値を指定してください。');
      }
      continue;
    }

    throw new Error(`不明な引数です: ${arg}`);
  }

  return {
    authorization,
    help,
  };
}

export function createGraphqlClient(authorization) {
  return graphql.defaults({
    headers: {
      authorization,
    },
  });
}

function sanitizeMessage(message, authorization) {
  if (!message) {
    return 'GraphQL request failed.';
  }

  return message
    .replaceAll(authorization, '[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)(token|bearer)\s+[^\s,;]+/gi, '$1[REDACTED]');
}

export async function executeGraphqlCheck(authorization) {
  const client = createGraphqlClient(authorization);
  return client(DEFAULT_QUERY, DEFAULT_OPTIONS);
}

export async function main(
  argv = process.argv.slice(2),
  io = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
) {
  let parsedArgs;

  try {
    parsedArgs = parseCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : '引数の解析に失敗しました。';
    io.stderr(`${message}\n\n${USAGE}`);
    return 1;
  }

  if (parsedArgs.help) {
    io.stdout(USAGE);
    return 0;
  }

  if (!parsedArgs.authorization) {
    io.stderr(`--authorization は必須です。\n\n${USAGE}`);
    return 1;
  }

  try {
    const result = await executeGraphqlCheck(parsedArgs.authorization);
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof Error ? sanitizeMessage(error.message, parsedArgs.authorization) : 'GraphQL request failed.';
    io.stderr(`GraphQL request failed: ${message}\n`);
    return 1;
  }
}

function isExecutedAsScript(metaUrl) {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return fileURLToPath(metaUrl) === entrypoint;
}

if (isExecutedAsScript(import.meta.url)) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
