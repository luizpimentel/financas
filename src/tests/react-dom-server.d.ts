declare module 'react-dom/server' {
  import type { ReactNode } from 'react';
  export function renderToStaticMarkup(element: ReactNode): string;
  export function renderToString(element: ReactNode): string;
}

