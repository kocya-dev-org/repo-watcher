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

export type EncryptedPatPayload = {
  version: 1;
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
  encryptedAt: string;
};

const TOKEN_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /(authorization\s*[:=]\s*)(token|bearer)\s+[^\s,;]+/gi,
  /(token\s+)[A-Za-z0-9_]+/gi,
  /(bearer\s+)[A-Za-z0-9_]+/gi,
];
const PAT_ENCRYPTION_ITERATIONS = 120_000;

/**
 * Uint8Array を Web Crypto API で使いやすい ArrayBuffer にコピーする。
 * @param bytes 変換元のバイト列
 * @returns 同じ内容を持つ ArrayBuffer
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * バイト列を base64 文字列へ変換する。
 * @param bytes 変換元のバイト列
 * @returns base64 文字列
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

/**
 * base64 文字列をバイト列へ戻す。
 * @param value base64 文字列
 * @returns 復元したバイト列
 */
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * 起動時刻から PAT 暗号化用の AES-GCM 鍵を導出する。
 * @param startupTime 鍵導出に使う起動時刻
 * @param salt 鍵導出用ソルト
 * @param iterations PBKDF2 の反復回数
 * @returns 導出した暗号鍵
 */
async function derivePatEncryptionKey(startupTime: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(startupTime), 'PBKDF2', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
}

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
 * PAT を起動時刻ベースの鍵で暗号化して保存用 payload へ変換する。
 * @param pat GitHub Personal Access Token
 * @param startupTime 鍵導出に使う起動時刻
 * @returns 永続化可能な暗号化 payload
 */
export async function encryptPat(pat: string, startupTime: string): Promise<EncryptedPatPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePatEncryptionKey(startupTime, salt, PAT_ENCRYPTION_ITERATIONS);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    key,
    new TextEncoder().encode(pat),
  );

  return {
    version: 1,
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: PAT_ENCRYPTION_ITERATIONS,
    encryptedAt: new Date().toISOString(),
  };
}

/**
 * 保存済みの暗号化 payload を起動時刻ベースの鍵で複号する。
 * @param payload 暗号化済み PAT
 * @param startupTime 鍵導出に使う起動時刻
 * @returns 複号した PAT
 */
export async function decryptPat(payload: EncryptedPatPayload, startupTime: string): Promise<string> {
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const key = await derivePatEncryptionKey(startupTime, salt, payload.iterations);
  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    key,
    toArrayBuffer(ciphertext),
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * ログ文字列に含まれる認証情報らしき文字列を伏せる。
 * @param text 元の文字列
 * @returns 機微情報を伏せた文字列
 */
export function redactSensitiveText(text: string): string {
  let redacted = text;

  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, (_match, prefix?: string) => {
      if (typeof prefix === 'string') {
        return `${prefix}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }

  return redacted;
}

/**
 * GraphQL エラー配列からログ出力用の最小情報だけを抽出する。
 * @param errors GraphQL エラー配列
 * @returns サニタイズ済みエラー一覧
 */
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
