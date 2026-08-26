/**
 * A tiny DOM for testing the view modules that build elements.
 *
 * `bots/grounding.view.ts` established the seam -- a `MinimalDocument` injected
 * with `document` as the default -- but there was nowhere to plug into it, so
 * every DOM-building view stayed uncovered and leaned on `pnpm test:e2e`.
 * This is the other half.
 *
 * It implements only what those views touch, and it keeps real node identity,
 * which is the whole point: a test that compares rendered text cannot tell a
 * reused node from a recreated one, and recreating is the defect.
 */

export interface MiniElement {
  tagName: string;
  className: string;
  textContent: string;
  type?: string;
  dataset: Record<string, string | undefined>;
  attributes: Record<string, string>;
  children: MiniElement[];
  parent: MiniElement | null;
  readonly firstElementChild: MiniElement | null;
  readonly nextElementSibling: MiniElement | null;
  append(...nodes: MiniElement[]): void;
  insertBefore(node: MiniElement, reference: MiniElement | null): void;
  querySelector(selector: string): MiniElement | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
  /** Test-only: fire the listeners registered for `type`. */
  dispatch(type: string): void;
}

export function createElement(tagName: string): MiniElement {
  const listeners = new Map<string, Array<() => void>>();
  const element: MiniElement = {
    tagName,
    className: '',
    textContent: '',
    dataset: {},
    attributes: {},
    children: [],
    parent: null,
    get firstElementChild() {
      return element.children[0] ?? null;
    },
    get nextElementSibling() {
      const siblings = element.parent?.children ?? [];
      const index = siblings.indexOf(element);
      return index === -1 ? null : siblings[index + 1] ?? null;
    },
    append(...nodes) {
      for (const node of nodes) element.insertBefore(node, null);
    },
    insertBefore(node, reference) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      const at = reference ? element.children.indexOf(reference) : -1;
      if (at === -1) element.children.push(node);
      else element.children.splice(at, 0, node);
      node.parent = element;
    },
    querySelector(selector) {
      const wanted = selector.startsWith('.') ? selector.slice(1) : null;
      if (!wanted) throw new Error(`mini-dom supports class selectors only, got ${selector}`);
      const walk = (node: MiniElement): MiniElement | null => {
        for (const child of node.children) {
          if (child.className.split(/\s+/).includes(wanted)) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(element);
    },
    setAttribute(name, value) {
      element.attributes[name] = value;
    },
    remove() {
      const siblings = element.parent?.children;
      if (siblings) siblings.splice(siblings.indexOf(element), 1);
      element.parent = null;
    },
    addEventListener(type, listener) {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return element;
}

export function createMiniDocument(): { createElement(tagName: string): HTMLElement } {
  return { createElement: (tagName: string) => createElement(tagName) as unknown as HTMLElement };
}

/** The flattened class/text shape of a subtree, for readable assertions. */
export function outline(element: MiniElement): Array<{ className: string; text: string }> {
  return element.children.map((child) => ({
    className: child.className,
    text: child.children.length === 0
      ? child.textContent
      : child.children.map((grandchild) => grandchild.textContent).join('|'),
  }));
}
