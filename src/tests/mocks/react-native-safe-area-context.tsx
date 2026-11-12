import React, { type ReactNode } from 'react';

export interface EdgeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

let mockInsets: EdgeInsets = {
  top: 24,
  right: 0,
  bottom: 16,
  left: 0,
};

export function setMockSafeAreaInsets(insets: Partial<EdgeInsets>): void {
  mockInsets = { ...mockInsets, ...insets };
}

export function resetMockSafeAreaInsets(): void {
  mockInsets = { top: 24, right: 0, bottom: 16, left: 0 };
}

export function useSafeAreaInsets(): EdgeInsets {
  return mockInsets;
}

export function SafeAreaProvider({ children }: { readonly children?: ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

