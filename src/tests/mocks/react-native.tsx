import React, { type ReactNode } from 'react';

export interface CapturedNode {
  readonly componentType: string;
  readonly testID?: string;
  readonly props: Record<string, unknown>;
  readonly style: Record<string, unknown>;
  readonly pressedStyle?: Record<string, unknown>;
  readonly textContent: string;
}

type NodeCollector = (node: CapturedNode) => void;

let activeCollector: NodeCollector | null = null;

export function runWithNodeCollector<T>(
  collector: NodeCollector,
  fn: () => T,
): T {
  const previous = activeCollector;
  activeCollector = collector;
  try {
    return fn();
  } finally {
    activeCollector = previous;
  }
}

export function flattenStyle(input: unknown): Record<string, unknown> {
  if (!input) {
    return {};
  }
  if (Array.isArray(input)) {
    const merged: Record<string, unknown> = {};
    for (const item of input) {
      Object.assign(merged, flattenStyle(item));
    }
    return merged;
  }
  if (typeof input === 'object') {
    return { ...(input as Record<string, unknown>) };
  }
  return {};
}

export function extractTextContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join('');
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractTextContent(props.children);
  }
  return '';
}

function registerNode(
  componentType: string,
  props: Record<string, unknown>,
  style: Record<string, unknown>,
  pressedStyle?: Record<string, unknown>,
) {
  if (!activeCollector) {
    return;
  }
  const testID = typeof props.testID === 'string' ? props.testID : undefined;
  const textContent = extractTextContent(props.children as ReactNode);
  activeCollector({
    componentType,
    testID,
    props,
    style,
    pressedStyle,
    textContent,
  });
}

function createMockComponent(componentType: string, htmlTag: 'div' | 'span' | 'input' | 'button') {
  return function MockComponent(props: Record<string, unknown>) {
    const rawStyle = props.style;
    const resolvedStyle =
      typeof rawStyle === 'function'
        ? flattenStyle((rawStyle as (state: { pressed: boolean }) => unknown)({ pressed: false }))
        : flattenStyle(rawStyle);
    const resolvedPressedStyle =
      typeof rawStyle === 'function'
        ? flattenStyle((rawStyle as (state: { pressed: boolean }) => unknown)({ pressed: true }))
        : undefined;

    registerNode(componentType, props, resolvedStyle, resolvedPressedStyle);

    if (htmlTag === 'input') {
      return React.createElement('input', {
        'data-testid': props.testID,
        value: typeof props.value === 'string' ? props.value : '',
        readOnly: true,
      });
    }

    return React.createElement(
      htmlTag,
      { 'data-testid': props.testID },
      props.children as ReactNode,
    );
  };
}

export const View = createMockComponent('View', 'div');
export const Text = createMockComponent('Text', 'span');
export const TextInput = createMockComponent('TextInput', 'input');
export const Pressable = createMockComponent('Pressable', 'button');
export const ScrollView = createMockComponent('ScrollView', 'div');
export const KeyboardAvoidingView = createMockComponent('KeyboardAvoidingView', 'div');

export function Modal(props: Record<string, unknown>) {
  if (props.visible === false) {
    return null;
  }
  registerNode('Modal', props, flattenStyle(props.style));
  return React.createElement(
    'div',
    { 'data-testid': props.testID ?? 'modal' },
    props.children as ReactNode,
  );
}

export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
  flatten: flattenStyle,
};

export const Platform = {
  OS: 'android' as 'android' | 'ios' | 'web',
  select<T>(specifics: { android?: T; ios?: T; default?: T }): T | undefined {
    return specifics.android ?? specifics.default;
  },
};

