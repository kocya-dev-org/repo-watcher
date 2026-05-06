import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export async function renderReact(element: React.ReactElement) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(element);
  });

  return {
    container,
    async rerender(nextElement: React.ReactElement) {
      await act(async () => {
        root?.render(nextElement);
      });
    },
    async unmount() {
      await act(async () => {
        root?.unmount();
        root = null;
      });
      container.remove();
    },
  };
}

export async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}
