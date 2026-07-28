import React from 'react';
import { useTranslation } from 'react-i18next';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
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
  const commentCount = Math.min(99, Math.max(0, notification.commentCount ?? 0));
  const commentCountLabel = `コメント数:${commentCount}`;
  // 最新コメント URL が取得できている場合のみリンクとして扱う
  const hasComments = (notification.commentCount ?? 0) > 0 && Boolean(notification.latestCommentUrl);
  const commentStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    marginLeft: '8px',
    fontSize: '11px',
    flexShrink: 0,
  };

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
          color: COLORS.fgMuted,
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
        {notification.isPullRequest && notification.isDraft === true && (
          <span
            style={{
              fontSize: '10px',
              color: COLORS.bgDefault,
              backgroundColor: COLORS.fgDefault,
              borderRadius: '10px',
              padding: '1px 6px',
            }}
          >
            {t('notificationKind.draft')}
          </span>
        )}
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
        {notification.isChangesRequested === true && (
          <span
            style={{
              fontSize: '10px',
              color: COLORS.bgDefault,
              backgroundColor: COLORS.danger,
              borderRadius: '10px',
              padding: '1px 6px',
            }}
          >
            {t('notificationKind.changesRequested')}
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
      {hasComments ? (
        <a
          href={notification.latestCommentUrl}
          target="_blank"
          rel="noreferrer"
          style={{ ...commentStyle, color: COLORS.fgDefault, cursor: 'pointer', textDecoration: 'none' }}
          title={t('commentLink.open')}
          aria-label={commentCountLabel}
        >
          <ChatBubbleIcon sx={{ fontSize: '15px' }} />
          {commentCount}
        </a>
      ) : (
        <span style={{ ...commentStyle, color: COLORS.fgSubtle }} aria-label={commentCountLabel}>
          <ChatBubbleIcon sx={{ fontSize: '15px' }} />
          {commentCount}
        </span>
      )}
    </li>
  );
};

export default NotificationItem;
