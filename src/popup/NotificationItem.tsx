import React from 'react';
import { useTranslation } from 'react-i18next';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import IconButton from '@mui/material/IconButton';

import { COLORS } from '../shared/colors';
import { formatNotificationKindLabel, getNotificationKinds, type StoredNotification } from '../shared/notifications';

type NotificationItemProps = {
  notification: StoredNotification;
  isRead: boolean;
  repositoryColor: string;
  onToggleRead: (id: string) => void;
};

/**
 * ポップアップの通知一覧に表示する 1 件分の通知項目コンポーネント。
 * @param notification 表示する通知データ
 * @param isRead 既読かどうか
 * @param repositoryColor リポジトリ色 (縦ライン)
 * @param onToggleRead 既読/未読切り替えハンドラ
 */
const NotificationItem: React.FC<NotificationItemProps> = ({ notification, isRead, repositoryColor, onToggleRead }) => {
  const { t } = useTranslation();
  const isMissingFromLatestResult = notification.isPresentInLatestResult === false;
  const kindLabels = getNotificationKinds(notification).map((kind) => t(formatNotificationKindLabel(kind)));

  return (
    <li
      aria-label={`リポジトリ色:${repositoryColor}`}
      style={{
        padding: '6px 8px 6px 5px',
        borderLeft: `3px solid ${repositoryColor}`,
        borderBottom: `1px solid ${COLORS.borderSubtle}`,
        display: 'flex',
        alignItems: 'center',
        backgroundColor: isMissingFromLatestResult ? COLORS.bgSubtle : 'transparent',
        borderRadius: 0,
      }}
    >
      <IconButton
        onClick={() => onToggleRead(notification.id)}
        size="small"
        sx={{
          marginRight: '6px',
          padding: 0,
          color: isRead ? COLORS.fgMuted : COLORS.successEmphasis,
          flexShrink: 0,
        }}
        title={isRead ? t('readState.read') : t('readState.unread')}
        aria-label={isRead ? t('readState.read') : t('readState.unread')}
      >
        {isRead ? <CheckBoxIcon fontSize="small" /> : <CheckBoxOutlineBlankIcon fontSize="small" />}
      </IconButton>
      <a
        href={notification.url}
        target="_blank"
        rel="noreferrer"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '12px',
          color: isMissingFromLatestResult ? COLORS.fgMuted : COLORS.accent,
          textDecoration: 'underline',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {notification.title}
      </a>
      <span
        style={{
          display: 'flex',
          gap: '4px',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          marginLeft: '8px',
          flexShrink: 0,
        }}
      >
        {notification.isApproved === true && (
          <span
            style={{
              fontSize: '10px',
              color: COLORS.bgDefault,
              backgroundColor: COLORS.success,
              borderRadius: '10px',
              padding: '1px 6px',
            }}
          >
            {t('notificationKind.approved')}
          </span>
        )}
        {kindLabels.map((label) => (
          <span
            key={`${notification.id}:${label}`}
            style={{
              fontSize: '10px',
              color: COLORS.bgDefault,
              backgroundColor: COLORS.accent,
              borderRadius: '10px',
              padding: '1px 6px',
            }}
          >
            {label}
          </span>
        ))}
      </span>
    </li>
  );
};

export default NotificationItem;
