/**
 * background service worker が利用する GitHub GraphQL クエリ定義。
 *
 * クエリ文字列を 1 箇所へ集約し、監視ロジック本体と責務を分離する。
 */

/** 監視対象の Issue / PullRequest を検索するクエリ。 */
export const WATCH_ISSUES_AND_PRS_QUERY = `
  query WatchIssuesAndPRs(
    $repoQuery: String!
  ) {
    search(query: $repoQuery, type: ISSUE, first: 50) {
      issueCount
      nodes {
        __typename
        ... on Issue {
          id
          number
          title
          url
          createdAt
          updatedAt
          repository {
            name
            owner { login }
          }
          author { login }
          assignees(first: 10) {
            nodes { login }
          }
          body
          comments(first: 50) {
            nodes {
              body
              author { login }
              createdAt
              updatedAt
            }
          }
        }
        ... on PullRequest {
          id
          isDraft
          reviewDecision
          number
          title
          url
          createdAt
          updatedAt
          repository {
            name
            owner { login }
          }
          author { login }
          assignees(first: 10) {
            nodes { login }
          }
          body
          comments(first: 50) {
            nodes {
              body
              author { login }
              createdAt
              updatedAt
            }
          }
        }
      }
    }
  }
`;

/** 通知元 node の open/closed 状態を取得するクエリ。 */
export const WATCH_NOTIFICATION_STATUS_QUERY = `
  query WatchNotificationStatuses(
    $nodeIds: [ID!]!
  ) {
    nodes(ids: $nodeIds) {
      __typename
      ... on Issue {
        id
        closed
      }
      ... on PullRequest {
        id
        closed
        reviewDecision
      }
    }
  }
`;

/** PullRequest のレビュースレッド情報を取得するクエリ。 */
export const WATCH_REVIEW_THREADS_QUERY = `
  query WatchReviewThreads(
    $prIds: [ID!]!
  ) {
    nodes(ids: $prIds) {
      __typename
      ... on PullRequest {
        id
        number
        url
        title
        repository {
          name
          owner { login }
        }
        reviewThreads(first: 20) {
          nodes {
            id
            isResolved
            comments(first: 50) {
              nodes {
                id
                body
                author { login }
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;
