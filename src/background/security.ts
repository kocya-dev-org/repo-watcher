type ErrorWithDetails = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  errors?: unknown;
};

export type SanitizedGraphQLError = {
  message: string;
  type?: string;
};

export type SanitizedErrorLog = {
  name: string;
  message: string;
  status?: number;
  graphQLErrors?: SanitizedGraphQLError[];
};

const TOKEN_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /(authorization\s*[:=]\s*)(token|bearer)\s+[^\s,;]+/gi,
  /(token\s+)[A-Za-z0-9_]+/gi,
  /(bearer\s+)[A-Za-z0-9_]+/gi,
];

/**
 * PAT 全体をハッシュ化し、保存しても断片が漏れない比較キーを作る。
 * @param pat GitHub Personal Access Token
 * @returns 16 進表現の SHA-256 ハッシュ文字列
 */
export async function buildPatCacheKey(pat: string): Promise<string> {
  const data = new TextEncoder().encode(pat);
  const digest = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * ログ文字列に含まれる認証情報らしき文字列を伏せる。
 * @param text 元の文字列
 * @returns 機微情報を伏せた文字列
 */
export function redactSensitiveText(text: string): string {
  let redacted = text;

  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix?: string) => {
      if (typeof prefix === 'string') {
        return `${prefix}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }

  return redacted;
}

function sanitizeGraphQLErrors(errors: unknown): SanitizedGraphQLError[] | undefined {
  if (!Array.isArray(errors)) {
    return undefined;
  }

  const sanitized = errors
    .map((error) => {
      if (!error || typeof error !== 'object') {
        return null;
      }

      const record = error as Record<string, unknown>;
      const message = redactSensitiveText(String(record.message ?? 'Unknown GraphQL error'));
      const type = typeof record.type === 'string' ? record.type : undefined;

      return {
        message,
        ...(type ? { type } : {}),
      };
    })
    .filter((error): error is SanitizedGraphQLError => error !== null);

  return sanitized.length > 0 ? sanitized : undefined;
}

/**
 * 例外オブジェクトから安全にログへ出せる最小情報だけを抽出する。
 * @param error 捕捉した例外
 * @returns サニタイズ済みのログ情報
 */
export function sanitizeError(error: unknown): SanitizedErrorLog {
  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: redactSensitiveText(error),
    };
  }

  if (!error || typeof error !== 'object') {
    return {
      name: 'UnknownError',
      message: 'Unknown error',
    };
  }

  const details = error as ErrorWithDetails;
  const name = typeof details.name === 'string' ? details.name : 'Error';
  const message = redactSensitiveText(String(details.message ?? 'Unknown error'));
  const status = typeof details.status === 'number' ? details.status : undefined;
  const graphQLErrors = sanitizeGraphQLErrors(details.errors);

  return {
    name,
    message,
    ...(status !== undefined ? { status } : {}),
    ...(graphQLErrors ? { graphQLErrors } : {}),
  };
}
