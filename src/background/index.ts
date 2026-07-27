/**
 * background service worker のエントリポイント。
 *
 * 監視サイクルの実装は `watchCycle.ts`、Chrome イベントの配線は `eventListeners.ts` にある。
 * このファイルは読み込み時に配線と初期化だけを行う。
 */
import { registerEventListeners } from './eventListeners';
import { restoreBadge } from './watchCycle';

export type { WatchTargetRepo } from '../shared/repositories';

registerEventListeners();

void restoreBadge();
