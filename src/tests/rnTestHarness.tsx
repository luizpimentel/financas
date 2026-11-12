import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  runWithNodeCollector,
  type CapturedNode,
} from './mocks/react-native';

export interface RenderedTestTree {
  /** HTML estático gerado pela renderização. */
  readonly html: string;
  /** Todos os nós React Native capturados durante a renderização. */
  readonly nodes: readonly CapturedNode[];
  /** Busca um nó pelo seu `testID`. Lança erro caso não exista. */
  getByTestId(testID: string): CapturedNode;
  /** Busca um nó pelo seu `testID` ou retorna `undefined`. */
  queryByTestId(testID: string): CapturedNode | undefined;
  /** Dispara o evento `onPress` em um nó `Pressable`, respeitando `disabled`. */
  firePress(testID: string): void;
  /** Dispara o evento `onChangeText` em um nó `TextInput`, respeitando `editable`. */
  fireChangeText(testID: string, text: string): void;
  /** Re-renderiza a árvore com novas props. */
  rerender(nextElement: ReactElement): void;
}

export function renderTestTree(initialElement: ReactElement): RenderedTestTree {
  let currentHtml = '';
  let capturedNodes: CapturedNode[] = [];

  function performRender(element: ReactElement) {
    const nextNodes: CapturedNode[] = [];
    currentHtml = runWithNodeCollector(
      (node) => {
        nextNodes.push(node);
      },
      () => renderToStaticMarkup(element),
    );
    capturedNodes = nextNodes;
  }

  performRender(initialElement);

  function queryByTestId(testID: string): CapturedNode | undefined {
    return capturedNodes.find((n) => n.testID === testID);
  }

  function getByTestId(testID: string): CapturedNode {
    const found = queryByTestId(testID);
    if (!found) {
      const available = capturedNodes
        .map((n) => n.testID)
        .filter(Boolean)
        .join(', ');
      throw new Error(
        `Elemento com testID="${testID}" não encontrado. Disponíveis: [${available}]`,
      );
    }
    return found;
  }

  function firePress(testID: string): void {
    const target = getByTestId(testID);
    if (target.props.disabled === true) {
      return;
    }
    const handler = target.props.onPress;
    if (typeof handler !== 'function') {
      throw new Error(`Elemento testID="${testID}" não possui prop onPress.`);
    }
    (handler as () => void)();
  }

  function fireChangeText(testID: string, text: string): void {
    const target = getByTestId(testID);
    if (target.props.editable === false) {
      return;
    }
    const handler = target.props.onChangeText;
    if (typeof handler !== 'function') {
      throw new Error(`Elemento testID="${testID}" não possui prop onChangeText.`);
    }
    (handler as (value: string) => void)(text);
  }

  return {
    get html() {
      return currentHtml;
    },
    get nodes() {
      return capturedNodes;
    },
    getByTestId,
    queryByTestId,
    firePress,
    fireChangeText,
    rerender: performRender,
  };
}

