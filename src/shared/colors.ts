/**
 * popup / options で共有する UI カラーパレット。
 *
 * GitHub Primer に準拠した配色を 1 箇所に集約し、散在する HEX リテラルを排除する。
 */
export const COLORS = {
  /** 既定の前景色 (濃いグレー) */
  fgDefault: '#24292f',
  /** 補助的な前景色 */
  fgMuted: '#57606a',
  /** さらに控えめな前景色 */
  fgSubtle: '#6e7781',
  /** 説明文などの中間グレー */
  fgNeutral: '#555',
  /** アクセント色 (リンク / ボタン) */
  accent: '#0969da',
  /** 枠線色 */
  border: '#d0d7de',
  /** 控えめな枠線色 */
  borderMuted: '#d8dee4',
  /** 区切り線 (薄いグレー) */
  borderSubtle: '#eee',
  /** 背景の白 */
  bgDefault: '#fff',
  /** 控えめな背景色 */
  bgSubtle: '#f6f8fa',
  /** 成功色 */
  success: '#1a7f37',
  /** 成功色 (強調) */
  successEmphasis: '#2da44e',
  /** エラー色 */
  danger: '#cf222e',
  /** エラー色 (通知バー) */
  dangerAlt: '#d1242f',
} as const;
