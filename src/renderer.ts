import {
  effect,
  reactive,
  ref,
  shallowReactive,
  shallowReadonly,
} from "./reactive";
import { getSequence } from "./utils";

type Props = Record<string, any>;

export interface VNode {
  type:
    | string
    | typeof Text
    | typeof Comment
    | typeof Fragment
    | ComponentOptions
    | ((() => VNode) & { props: Props });
  props?: Props;
  children?: string | VNode[] | Slots;
  el?: HTMLElement | Text | Comment | null;
  key?: any;
  component?: ComponentInstance;

  shouldKeepAlive?: boolean;
  keepAliveInstance?: ComponentInstance;
  keptAlive?: boolean;

  transition?: {
    beforeEnter: (el) => void;
    enter: (el) => void;
    leave: (el, performRemove: () => void) => void;
  };

  dynamicChildren?: VNode[];
  patchFlags?: number;
}

interface RendererOptions {
  createElement: (tag) => any;
  setElementText: (el, text) => void;
  insert: (el, parent, anchor?) => void;
  createText: (text: string) => any;
  setText: (el, text: string) => void;
  createComment: (text: string) => any;
  setComment: (el, text: string) => void;
  patchProps: (el, key: string, prevValue, nextValue) => void;
}

export interface ComponentOptions {
  name?: string;
  data?: () => Record<string, any>;
  props: Record<string, any>;
  render?: () => VNode;
  beforeCreate?: Function;
  created?: Function;
  beforeMount?: Function;
  mounted?: Function;
  beforeUpdate?: Function;
  updated?: Function;
  setup?: (
    props: ComponentOptions["props"],
    setupContext: SetupContext,
  ) => (() => VNode) | object;
  __isKeepAlive?: boolean;

  __isTeleport?: boolean;
  process?: (
    n1: VNode | null | undefined,
    n2: VNode,
    container,
    anchor,
    internals: RendererInternals,
  ) => void;
}

export interface ComponentInstance {
  state: object | null;
  props: object;
  isMounted: boolean;
  subTree: VNode | undefined;
  mounted: Function[];
  unmounted: Function[];

  _activate?: (newVnode: VNode, container, anchor?) => void;
  _deActivate?: (vnode: VNode) => void;
  keepAliveCtx?: {
    move: (vnode: VNode, parent, anchor?) => void;
    createElement: (tag: string) => any;
  };
}

export interface SetupContext {
  slots: Slots;
  emit: (event: string, ...payload) => void;
  attrs: object;
}

export type Slots = { [name: string]: () => VNode };

interface RendererInternals {
  patch: (n1: VNode | null, n2: VNode, container, anchor?) => void;
  patchChildren: (n1: VNode, n2: VNode, container) => void;
  move: (vnode: VNode, container, anchor?) => void;
}

const Text = Symbol("Text");
export const Comment = Symbol("Comment");
export const Fragment = Symbol("Fragment");

export function createRenderer(options: RendererOptions) {
  const {
    createElement,
    setElementText,
    insert,
    createText,
    setText,
    createComment,
    setComment,
    patchProps,
  } = options;

  function render(vnode: VNode, container: HTMLElement & { _vnode?: VNode }) {
    if (vnode) {
      patch(container._vnode, vnode, container);
    } else {
      if (container._vnode) {
        unmount(container._vnode);
      }
    }

    container._vnode = vnode;
  }

  function patch(
    oldVnode: VNode | null | undefined,
    newVnode: VNode,
    container,
    anchor?,
  ) {
    if (oldVnode && oldVnode.type !== newVnode.type) {
      unmount(oldVnode);
      oldVnode = undefined;
    }

    const { type } = newVnode;

    if (typeof type === "string") {
      if (!oldVnode) {
        mountElement(newVnode, container, anchor);
      } else {
        patchElement(oldVnode, newVnode);
      }
    } else if (type === Text) {
      // 文本节点
      if (!oldVnode) {
        const el = (newVnode.el = createText(newVnode.children as string));
        insert(el, container);
      } else {
        const el = (newVnode.el = oldVnode.el!);
        if (newVnode.children !== oldVnode.children) {
          setText(el, newVnode.children as string);
        }
      }
    } else if (type === Comment) {
      // 注释节点
      if (!oldVnode) {
        const el = (newVnode.el = createComment(newVnode.children as string));
        insert(el, container);
      } else {
        const el = (newVnode.el = oldVnode.el!);
        if (newVnode.children !== oldVnode.children) {
          setComment(el, newVnode.children as string);
        }
      }
    } else if (type === Fragment) {
      if (!oldVnode) {
        (newVnode.children as VNode[]).forEach((child) =>
          patch(undefined, child, container),
        );
      } else {
        patchChildren(oldVnode, newVnode, container);
      }
    } else if (typeof type === "object" && type.__isTeleport) {
      type.process!(oldVnode, newVnode, container, anchor, {
        patch,
        patchChildren,
        move(vnode: VNode, container, anchor) {
          insert(
            vnode.component ? vnode.component.subTree!.el : vnode.el,
            container,
            anchor,
          );
        },
      });
    } else if (typeof type === "object" || typeof type === "function") {
      // 有状态组件 or 函数式组件
      if (!oldVnode) {
        if (newVnode.keptAlive) {
          newVnode.keepAliveInstance?._activate?.(newVnode, container, anchor);
        } else {
          mountComponent(newVnode, container, anchor);
        }
      } else {
        patchComponent(oldVnode, newVnode, anchor);
      }
    }
  }

  function mountElement(vnode: VNode, container, anchor?) {
    if (typeof vnode.type === "string") {
      const el = (vnode.el = createElement(vnode.type));

      if (vnode.props) {
        Object.keys(vnode.props).forEach((key) => {
          const value = vnode.props![key];
          patchProps(el, key, null, value);
        });
      }

      if (typeof vnode.children === "string") {
        setElementText(el, vnode.children);
      } else if (Array.isArray(vnode.children)) {
        vnode.children.forEach((child) => {
          patch(undefined, child, el);
        });
      }

      if (vnode.transition) {
        vnode.transition.beforeEnter(el);
      }

      insert(el, container, anchor);

      if (vnode.transition) {
        vnode.transition.enter(el);
      }
    }
  }

  function unmount(vnode: VNode) {
    if (vnode.type === Fragment) {
      (vnode.children as VNode[]).forEach((child) => unmount(child));
      return;
    } else if (typeof vnode.type === "object") {
      if (vnode.shouldKeepAlive) {
        vnode.keepAliveInstance?._deActivate?.(vnode);
      } else {
        vnode.component?.subTree && unmount(vnode.component.subTree);
        vnode.component?.unmounted.forEach((fn) => fn());
      }

      return;
    }

    if (vnode.el) {
      const parent = vnode.el.parentNode;
      if (parent) {
        const performRemove = () => parent.removeChild(vnode.el as HTMLElement);

        if (vnode.transition) {
          vnode.transition.leave(vnode.el, performRemove);
        } else {
          performRemove();
        }
      }
    }
  }

  function patchElement(oldVnode: VNode, newVnode: VNode) {
    const el = (newVnode.el = oldVnode.el);
    const oldProps = oldVnode.props || {};
    const newProps = newVnode.props || {};

    if (newVnode.patchFlags) {
      // 靶向更新
      if (newVnode.patchFlags === 1) {
        setElementText(newVnode.el, newVnode.children);
      }
    } else {
      // 全量更新
      Object.keys(newProps).forEach((key) => {
        if (newProps[key] !== oldProps[key]) {
          patchProps(el, key, oldProps[key], newProps[key]);
        }
      });

      Object.keys(oldProps).forEach((key) => {
        if (!(key in newProps)) {
          patchProps(el, key, oldProps[key], null);
        }
      });

      if (newVnode.dynamicChildren) {
        // 跳过静态节点，直接对比动态节点
        patchBlockChildren(oldVnode, newVnode, el);
      } else {
        patchChildren(oldVnode, newVnode, el);
      }
    }
  }

  function patchBlockChildren(n1: VNode, n2: VNode, container) {
    n2.dynamicChildren?.forEach((c, i) => {
      // patchElement(n1.dynamicChildren![i], c);
      patch(n1.dynamicChildren![i], c, container);
    });
  }

  function patchChildren(n1: VNode, n2: VNode, container) {
    if (!n2.children) {
      if (typeof n1.children === "string") {
        setElementText(container, "");
      } else if (Array.isArray(n1.children)) {
        n1.children.forEach((child) => unmount(child));
      }
    } else if (typeof n2.children === "string") {
      if (Array.isArray(n1.children)) {
        n1.children.forEach((child) => unmount(child));
      }
      setElementText(container, n2.children);
    } else {
      if (Array.isArray(n1.children)) {
        patchKeyedChildren(n1, n2, container);
      } else {
        setElementText(container, "");
        n2.children.forEach((child) => {
          patch(undefined, child, container);
        });
      }
    }
  }

  /**
   * 用简单diff处理两组子节点
   * @param n1
   * @param n2
   * @param container
   */
  function patchKeyedChildren1(n1: VNode, n2: VNode, container) {
    const oldChildren = n1.children as VNode[];
    const newChildren = n2.children as VNode[];

    // 在旧 children 中寻找具有相同 key 值节点的过程中，遇到的最大索引值
    let lastIndex = 0;
    for (let i = 0; i < newChildren.length; i++) {
      const newVnode = newChildren[i];

      let find = false;
      for (let j = 0; j < oldChildren.length; j++) {
        const oldVnode = oldChildren[j];
        if (newVnode.key === oldVnode.key) {
          find = true;

          patch(oldVnode, newVnode, container);
          if (j < lastIndex) {
            // 需要移动
            const prevNode = newChildren[i - 1];
            if (prevNode) {
              const anchor = prevNode.el!.nextSibling;
              insert(newVnode.el, container, anchor);
            }
          } else {
            lastIndex = j;
          }
          break;
        }
      }
      if (!find) {
        // 证明newVnode是新增的节点
        const prevNode = newChildren[i - 1];
        let anchor;
        if (prevNode) {
          anchor = prevNode.el!.nextSibling;
        } else {
          anchor = (container as HTMLElement).firstChild;
        }
        patch(undefined, newVnode, container, anchor);
      }
    }

    // 删除多余的旧节点
    oldChildren.forEach((oldVnode) => {
      const has = newChildren.find((vnode) => vnode.key === oldVnode.key);
      if (!has) {
        unmount(oldVnode);
      }
    });
  }

  /**
   * 用双端diff处理两组子节点
   * @param n1
   * @param n2
   * @param container
   */
  function patchKeyedChildren2(n1: VNode, n2: VNode, container) {
    const oldChildren = n1.children as VNode[];
    const newChildren = n2.children as VNode[];

    let oldStartIndex = 0;
    let oldEndIndex = oldChildren.length - 1;
    let newStartIndex = 0;
    let newEndIndex = newChildren.length - 1;

    let oldStartVnode = oldChildren[oldStartIndex];
    let oldEndVnode = oldChildren[oldEndIndex];
    let newStartVnode = newChildren[newStartIndex];
    let newEndVnode = newChildren[newEndIndex];

    while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) {
      if (!oldStartVnode) {
        // 不存在即处理过了，跳过即可
        oldStartVnode = oldChildren[++oldStartIndex];
      } else if (!oldEndVnode) {
        // 同上
        oldEndVnode = oldChildren[--oldEndIndex];
      } else if (oldStartVnode.key === newStartVnode.key) {
        patch(oldStartVnode, newStartVnode, container);
        oldStartVnode = oldChildren[++oldStartIndex];
        newStartVnode = newChildren[++newStartIndex];
      } else if (oldEndVnode.key === newEndVnode.key) {
        patch(oldEndVnode, newEndVnode, container);
        oldEndVnode = oldChildren[--oldEndIndex];
        newEndVnode = newChildren[--newEndIndex];
      } else if (oldStartVnode.key === newEndVnode.key) {
        patch(oldStartVnode, newEndVnode, container);
        insert(oldStartVnode.el, container, oldEndVnode.el!.nextSibling);
        oldStartVnode = oldChildren[++oldStartIndex];
        newEndVnode = newChildren[--newEndIndex];
      } else if (oldEndVnode.key === newStartVnode.key) {
        patch(oldEndVnode, newStartVnode, container);
        insert(oldEndVnode.el, container, oldStartVnode.el);
        oldEndVnode = oldChildren[--oldEndIndex];
        newStartVnode = newChildren[++newStartIndex];
      } else {
        // 以上都无法匹配时，尝试寻找newStartVnode有无可复用的节点
        const idxInOld = oldChildren.findIndex(
          (vnode) => vnode.key === newStartVnode.key,
        );
        if (idxInOld > 0) {
          patch(oldChildren[idxInOld], newStartVnode, container);
          insert(oldChildren[idxInOld].el, container, oldStartVnode.el);
          // 表示已经处理过了
          oldChildren[idxInOld] = undefined as any;
        } else {
          // 证明newStartVnode是新增的节点
          patch(undefined, newStartVnode, container, oldStartVnode.el);
        }
        newStartVnode = newChildren[++newStartIndex];
      }
    }

    if (oldStartIndex > oldEndIndex && newStartIndex <= newEndIndex) {
      // newChildren中还有遗漏的节点
      for (let i = newStartIndex; i <= newEndIndex; i++) {
        // patch(undefined, newChildren[i], container, oldStartVnode.el);

        /*
        我觉得这种比上面作者写的好理解一点，即借鉴作者写的快速diff的预处理过程，很奇怪，
        作者在【双端diff】和【快速diff预处理过程】对于新增节点的处理写法居然不一样，
        我觉得两者对剩余节点的判断逻辑是一样的
        */
        const anchorIndex = newEndIndex + 1;
        const anchor =
          anchorIndex < newChildren.length ? newChildren[anchorIndex].el : null;
        patch(undefined, newChildren[i], container, anchor);
      }
    } else if (newStartIndex > newEndIndex && oldStartIndex <= oldEndIndex) {
      // oldChildren中还有遗漏的节点
      for (let i = oldStartIndex; i <= oldEndIndex; i++) {
        unmount(oldChildren[i]);
      }
    }
  }

  /**
   * 用快速diff处理两组子节点
   * @param n1
   * @param n2
   * @param container
   */
  function patchKeyedChildren(n1: VNode, n2: VNode, container) {
    const oldChildren = n1.children as VNode[];
    const newChildren = n2.children as VNode[];

    // 处理相同的前置节点
    let j = 0;
    let oldVnode = oldChildren[j];
    let newVnode = newChildren[j];
    while (oldVnode && newVnode && oldVnode.key === newVnode.key) {
      patch(oldVnode, newVnode, container);

      j++;
      oldVnode = oldChildren[j];
      newVnode = newChildren[j];
    }

    // 处理相同的后置节点
    let oldEnd = oldChildren.length - 1;
    let newEnd = newChildren.length - 1;
    oldVnode = oldChildren[oldEnd];
    newVnode = newChildren[newEnd];
    if (j < oldChildren.length && j < newChildren.length) {
      while (oldVnode.key === newVnode.key) {
        patch(oldVnode, newVnode, container);

        oldEnd--;
        newEnd--;
        oldVnode = oldChildren[oldEnd];
        newVnode = newChildren[newEnd];
      }
    }

    if (j > oldEnd && j <= newEnd) {
      // 处理遗漏的新增节点
      for (let i = j; i <= newEnd; i++) {
        const anchorIndex = newEnd + 1;
        const anchor =
          anchorIndex < newChildren.length ? newChildren[anchorIndex].el : null;
        patch(undefined, newChildren[i], container, anchor);
      }
    } else if (j > newEnd && j <= oldEnd) {
      // 处理遗漏的删除节点
      for (let i = j; i <= oldEnd; i++) {
        unmount(oldChildren[i]);
      }
    } else {
      const count = newEnd - j + 1;
      // 储存新的一组子节点在旧的一组子节点中的索引
      const source = new Array(count);
      source.fill(-1);

      const keyIndex = {};
      for (let i = j; i <= newEnd; i++) {
        keyIndex[newChildren[i].key] = i;
      }

      // 是否需要移动节点
      let moved = false;
      // 储存遇到的最大索引
      let pos = 0;
      let patched = 0;

      for (let m = j; m <= oldEnd; m++) {
        oldVnode = oldChildren[m];

        if (patched <= count) {
          const n = keyIndex[oldVnode.key];
          if (n != null) {
            newVnode = newChildren[n];
            patch(oldVnode, newVnode, container);
            patched++;
            source[n - j] = m;

            if (n < pos) {
              moved = true;
            } else {
              pos = n;
            }
          } else {
            unmount(oldVnode);
          }
        } else {
          unmount(oldVnode);
        }
      }

      if (moved) {
        const seq = getSequence(source);

        let s = seq[seq.length - 1];
        let i = count - 1;
        for (i; i >= 0; i--) {
          if (source[i] === -1) {
            // 新增节点
            const pos = i + j;
            const newVnode = newChildren[pos];
            const anchorIndex = pos + 1;
            const anchor =
              anchorIndex < newChildren.length
                ? newChildren[anchorIndex].el
                : null;
            patch(undefined, newVnode, container, anchor);
          } else if (i !== s) {
            // 移动节点
            const pos = i + j;
            const newVnode = newChildren[i + j];
            const anchorIndex = pos + 1;
            const anchor =
              anchorIndex < newChildren.length
                ? newChildren[anchorIndex].el
                : null;
            insert(newVnode.el, container, anchor);
          } else {
            // 不需要移动
            s--;
          }
        }
      }
    }
  }

  function mountComponent(vnode: VNode, container, anchor?) {
    let componentOptions = vnode.type as ComponentOptions;
    if (typeof vnode.type === "function") {
      componentOptions = {
        props: vnode.type.props,
        render: vnode.type,
      };
    }

    const {
      props: propsOption,
      data,
      beforeCreate,
      created,
      beforeMount,
      mounted,
      beforeUpdate,
      updated,
      setup,
    } = componentOptions;
    let { render } = componentOptions;

    beforeCreate?.();

    const [props, attrs] = resolveProps(propsOption, vnode.props);

    const state = data ? reactive(data()) : null;

    const instance: ComponentInstance = {
      state,
      props: shallowReactive(props),
      isMounted: false,
      subTree: undefined,
      mounted: [],
      unmounted: [],
    };

    if (componentOptions.__isKeepAlive) {
      instance.keepAliveCtx = {
        move(vnode, parent, anchor?) {
          insert(vnode.component?.subTree?.el, parent, anchor);
        },
        createElement,
      };
    }

    function emit(event: string, ...payload) {
      const eventName = `on${event[0].toUpperCase()}${event.slice(1)}`;
      const handler = instance.props[eventName];
      if (handler) {
        handler(...payload);
      } else {
        console.error("事件不存在");
      }
    }

    const slots = (vnode.children || {}) as Slots;

    const setupContext: SetupContext = { attrs, emit, slots };
    let setupResult;
    let setupState;
    if (setup) {
      setCurrentInstance(instance);
      setupResult = setup(shallowReadonly(instance.props), setupContext);
      setCurrentInstance(null);

      if (typeof setupResult === "object") {
        setupState = setupResult;
      } else if (typeof setupResult === "function") {
        if (render) {
          console.warn("setup函数返回渲染函数，render选项将被忽略");
        }
        render = setupResult;
      }
    }

    vnode.component = instance;

    const renderContext = new Proxy(instance, {
      get(target, p, receiver) {
        if (p === "$slots") return slots;

        const { state, props } = target;

        if (state && p in state) {
          return state[p];
        } else if (props && p in props) {
          return props[p];
        } else if (setupState && p in setupState) {
          return setupState[p];
        } else {
          console.warn(`${p.toString()}不存在`);
        }
      },
      set(target, p, newValue, receiver) {
        const { state, props } = target;

        if (state && p in state) {
          state[p] = newValue;
          return true;
        } else if (props && p in props) {
          console.warn(`不允许设置prop ${p.toString()}，Props是只读的`);
          return false;
        } else if (setupState && p in setupState) {
          setupState[p] = newValue;
          return true;
        }

        console.warn(`${p.toString()}不存在`);
        return false;
      },
    });

    created?.call(renderContext);

    if (!render)
      throw new Error("你干嘛，没有render选项，setup也没返回渲染函数");

    effect(
      () => {
        const subTree = render.call(renderContext, renderContext);

        if (!instance.isMounted) {
          beforeMount?.call(renderContext);

          if (vnode.el) {
            // 说明是hydrate
            hydrateNode(vnode.el, subTree, container);
          } else {
            patch(undefined, subTree, container, anchor);
          }
          instance.isMounted = true;

          mounted?.call(renderContext);
          instance.mounted.forEach((fn) => fn.call(renderContext));
        } else {
          beforeUpdate?.call(renderContext);

          patch(instance.subTree, subTree, container, anchor);

          updated?.call(renderContext);
        }

        instance.subTree = subTree;
      },
      {
        scheduler: queueJob,
      },
    );
  }

  function patchComponent(n1: VNode, n2: VNode, anchor?) {
    const instance = (n2.component = n1.component);

    const { props } = instance as ComponentInstance;

    if (hasPropsChanged(n1.props, n2.props)) {
      const [nextProps] = resolveProps(
        (n2.type as ComponentOptions).props,
        n2.props,
      );

      Object.keys(nextProps).forEach((key) => {
        props[key] = nextProps[key];
      });

      Object.keys(props).forEach((key) => {
        if (!(key in nextProps)) {
          delete props[key];
        }
      });
    }
  }

  function hydrateNode(node: Node, vnode: VNode) {
    // 将虚拟DOM和真实DOM建立联系
    vnode.el = node;

    const type = typeof vnode.type;
    if (type === "object") {
      mountComponent(vnode);
    } else if (type === "string") {
      if (vnode.props) {
        Object.keys(vnode.props).forEach((key) => {
          if (/^on/.test(key)) {
            patchProps(node, key, null, vnode.props![key]);
          }
        });
      }

      if (Array.isArray(vnode.children)) {
        let nextNode = node.firstChild;
        vnode.children.forEach((c) => {
          nextNode = hydrateNode(nextNode, c);
        });
      }
    }

    return node.nextSibling;
  }

  function hydrate(vnode: VNode, container: HTMLElement) {
    hydrateNode(container.firstChild, vnode);
  }

  return { render, hydrate };
}

const queue = new Set<Function>();
let isFlushing = false;
const p = Promise.resolve();
function queueJob(job: Function) {
  queue.add(job);
  if (!isFlushing) {
    isFlushing = true;
    p.then(() => {
      try {
        queue.forEach((fn) => fn());
      } finally {
        isFlushing = false;
        queue.clear();
      }
    });
  }
}

function normalizeClass(value) {
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (!Array.isArray(value)) {
      return Object.keys(value)
        .map((key) => {
          return value[key] ? key : "";
        })
        .join(" ");
    } else {
      return value
        .map((item) => {
          return normalizeClass(item);
        })
        .join(" ");
    }
  }
}

function shouldSetAsProps(el: HTMLElement, key, value) {
  if (key === "form" && el.tagName === "INPUT") {
    return false;
  }
  return key in el;
}

export function resolveProps(propsOption, propsData) {
  const props = {};
  const attrs = {};

  Object.keys(propsData).forEach((key) => {
    // 自定义事件也添加到props
    if (key in propsOption || key.startsWith("on")) {
      props[key] = propsData[key];
    } else {
      attrs[key] = propsData[key];
    }
  });

  return [props, attrs];
}

function hasPropsChanged(prevProps, nextProps) {
  if (Object.keys(prevProps).length !== Object.keys(nextProps).length) {
    return true;
  }

  for (const key in prevProps) {
    if (prevProps[key] !== nextProps[key]) {
      return true;
    }
  }

  return false;
}

let currentInstance: ComponentInstance | null = null;
export function setCurrentInstance(instance: typeof currentInstance) {
  currentInstance = instance;
}
export function getCurrentInstance() {
  return currentInstance;
}

function onMounted(cb: Function) {
  if (currentInstance) {
    currentInstance.mounted.push(cb);
  } else {
    console.error("onMounted只能在setup函数中调用");
  }
}

export function onUnmounted(cb: Function) {
  if (currentInstance) {
    currentInstance.unmounted.push(cb);
  } else {
    console.error("onUnmounted只能在setup函数中调用");
  }
}

export const renderer = createRenderer({
  createElement(tag) {
    return document.createElement(tag);
  },
  setElementText(el, text) {
    (el as HTMLElement).textContent = text;
  },
  insert(el, parent, anchor) {
    (parent as HTMLElement).insertBefore(el, anchor);
  },
  createText(text) {
    return document.createTextNode(text);
  },
  setText(el, text) {
    el.nodeValue = text;
  },
  createComment(text) {
    return document.createComment(text);
  },
  setComment(el, text) {
    el.nodeValue = text;
  },
  patchProps(el, key, prevValue, nextValue) {
    if (key.startsWith("on")) {
      const eventName = key.slice(2).toLowerCase();
      let invokers = el._vei || (el._vei = {}); // vei = vue event invoker
      let invoker = invokers[key];

      if (nextValue) {
        if (!invoker) {
          invoker = invokers[key] = (e: Event) => {
            // 如果事件发生时间早于事件绑定的时间，则不执行
            if (e.timeStamp < invoker.attached) return;

            if (Array.isArray(invoker.value)) {
              invoker.value.forEach((fn) => fn(e));
            } else {
              invoker.value(e);
            }
          };

          el.addEventListener(eventName, invoker);
        }
        invoker.value = nextValue;
        invoker.attached = performance.now();
      } else if (invoker) {
        el.removeEventListener(eventName, invoker);
      }
    } else if (key === "class") {
      // className性能最好
      el.className = nextValue || "";
    } else if (shouldSetAsProps(el, key, nextValue)) {
      if (typeof el[key] === "boolean" && nextValue === "") {
        el[key] = true;
      } else {
        el[key] = nextValue;
      }
    } else {
      el.setAttribute(key, nextValue);
    }
  },
});

export function main() {
  function MyFuncComp(props) {
    return { type: "h1", children: `函数式组件，内容：${props.title}` };
  }
  MyFuncComp.props = { title: String };

  const vnode: VNode = {
    type: MyFuncComp,
    props: { title: "哈哈哈" },
  };

  renderer.render(vnode, document.getElementById("app")!);
}
