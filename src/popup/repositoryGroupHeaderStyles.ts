import type React from 'react';
import { COLORS } from '../shared/colors';

export const repositoryGroupHeaderStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: `1px solid ${COLORS.borderSubtle}`,
  background: COLORS.bgSubtle,
  color: COLORS.fgDefault,
  fontWeight: 600,
};

export const repositoryGroupHeaderButtonStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  ...repositoryGroupHeaderStyle,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  textAlign: 'left',
  font: 'inherit',
};
