import type React from 'react';

import { COLORS } from '../shared/colors';

/** 白背景の副次ボタン共通スタイル (cursor は呼び出し側で上書きする) */
export const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '4px',
  border: `1px solid ${COLORS.border}`,
  backgroundColor: COLORS.bgDefault,
  color: COLORS.fgDefault,
};

/** アクセント色の主要ボタン共通スタイル */
export const primaryButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: COLORS.accent,
  color: COLORS.bgDefault,
  cursor: 'pointer',
};
