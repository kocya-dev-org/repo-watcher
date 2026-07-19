export type WatchTargetRepo = {
  owner: string;
  name: string;
  color?: string;
};

export const DEFAULT_REPO_COLOR = '#0969da';

/**
 * owner / name が有効な文字列である監視対象リポジトリかどうかを判定する。
 * @param repo 判定対象。storage 由来の不定値も受け付ける
 * @returns owner と name が非空文字列なら true
 */
export function isValidRepo(repo: unknown): repo is WatchTargetRepo {
  return (
    typeof repo === 'object' &&
    repo !== null &&
    typeof (repo as WatchTargetRepo).owner === 'string' &&
    (repo as WatchTargetRepo).owner.length > 0 &&
    typeof (repo as WatchTargetRepo).name === 'string' &&
    (repo as WatchTargetRepo).name.length > 0
  );
}
