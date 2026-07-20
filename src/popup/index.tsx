import React from 'react';
import ReactDOM from 'react-dom/client';
import '../shared/i18n';
import App from './App';

/**
 * ポップアップ用の React アプリケーションのエントリポイント。
 * `root` 要素に `App` コンポーネントをマウントする。
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
