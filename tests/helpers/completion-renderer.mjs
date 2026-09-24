import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Small deterministic hook/effect host, not a browser or a replacement feature.
// The tests load the actual provider, row and recovery components, resolve their
// context, run their real effect cleanups and click their real event handlers.
// React DOM's server renderer renders the resulting host tree for markup checks.
// Native React scheduling/hydration remains a browser smoke-test concern.
let current;
export function createContext(value) {
  const context = { defaultValue: value };
  context.Provider = { context };
  return context;
}
export function useContext(context) { return current.renderer.contexts.get(context) ?? context.defaultValue; }
export function useState(init) {
  const instance = current;
  const index = instance.index++;
  if (!instance.slots[index]) instance.slots[index] = { value: typeof init === "function" ? init() : init };
  const slot = instance.slots[index];
  return [slot.value, (value) => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
}
export function useEffect(effect, deps) {
  const instance = current;
  const index = instance.index++;
  const slot = instance.slots[index];
  if (!slot || deps.some((value, i) => !Object.is(value, slot.deps[i]))) {
    instance.renderer.effects.push(() => {
      slot?.cleanup?.();
      instance.slots[index] = { deps, cleanup: effect() };
    });
  }
}
export function useSyncExternalStore(subscribe, getSnapshot) {
  current.snapshotReaders.push(getSnapshot);
  useEffect(() => subscribe(() => {}), [subscribe]);
  return getSnapshot();
}

export class CompletionRenderer {
  instances = new Map();
  contexts = new Map();
  effects = [];
  tree;
  render(element) {
    const visited = new Set();
    const walk = (node, path) => {
      if (Array.isArray(node)) return node.map((child, index) => walk(child, `${path}/${child?.key ?? index}`));
      if (!isValidElement(node)) return node;
      if (node.type?.context) {
        const context = node.type.context;
        const previous = this.contexts.get(context);
        this.contexts.set(context, node.props.value);
        const result = walk(node.props.children, path + "/context");
        if (previous === undefined) this.contexts.delete(context); else this.contexts.set(context, previous);
        return result;
      }
      if (typeof node.type === "function") {
        const id = `${path}/${node.type.name}:${node.key ?? ""}`;
        visited.add(id);
        let instance = this.instances.get(id);
        if (!instance) {
          instance = { renderer: this, type: node.type, slots: [], index: 0, snapshotReaders: [] };
          this.instances.set(id, instance);
        }
        instance.index = 0;
        instance.snapshotReaders = [];
        const previous = current;
        current = instance;
        let result;
        try { result = node.type(node.props); } finally { current = previous; }
        return walk(result, id);
      }
      return createElement(node.type, { ...node.props, key: node.key }, walk(node.props.children, path + "/children"));
    };
    this.tree = walk(element, "root");
    for (const [key, instance] of this.instances) if (!visited.has(key)) {
      for (const slot of instance.slots) slot?.cleanup?.();
      this.instances.delete(key);
    }
    for (const effect of this.effects.splice(0)) effect();
    return this.tree;
  }
  html() { return renderToStaticMarkup(this.tree); }
  find(predicate) {
    const matches = [];
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!isValidElement(node)) return;
      if (predicate(node)) matches.push(node);
      walk(node.props.children);
    };
    walk(this.tree);
    return matches;
  }
  unmount() {
    for (const instance of this.instances.values()) for (const slot of instance.slots) slot?.cleanup?.();
    this.instances.clear();
  }
}
