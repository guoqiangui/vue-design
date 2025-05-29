import { effect, ref } from "./reactive";

export type VNode = {
  type:
    | string
    | typeof Text
    | typeof Comment
    | typeof Fragment
    | { render: () => VNode };
  props?: Record<string, any>;
  children?: string | VNode[];
  el?: HTMLElement | Text | Comment | null;
  key?: any;
};

function mountComponent(vnode: VNode, container: HTMLElement) {
  const subtree = vnode.type.render();
  renderer(subtree, container);
}

type RendererOptions = {
  createElement: (tag) => any;
  setElementText: (el, text) => void;
  insert: (el, parent, anchor?) => void;
  createText: (text: string) => any;
  setText: (el, text: string) => void;
  createComment: (text: string) => any;
  setComment: (el, text: string) => void;
  patchProps: (el, key: string, prevValue, nextValue) => void;
};

const Text = Symbol("Text");
const Comment = Symbol("Comment");
const Fragment = Symbol("Fragment");

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
    oldVnode: VNode | undefined,
    newVnode: VNode,
    container,
    anchor?
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
          patch(undefined, child, container)
        );
      } else {
        patchChildren(oldVnode, newVnode, container);
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
      insert(el, container, anchor);
    }
  }

  function unmount(vnode: VNode) {
    if (vnode.type === Fragment) {
      (vnode.children as VNode[]).forEach((child) => unmount(child));
      return;
    }

    if (vnode.el) {
      const parent = vnode.el.parentNode;
      if (parent) {
        parent.removeChild(vnode.el);
      }
    }
  }

  function patchElement(oldVnode: VNode, newVnode: VNode) {
    const el = (newVnode.el = oldVnode.el);
    const oldProps = oldVnode.props || {};
    const newProps = newVnode.props || {};

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

    patchChildren(oldVnode, newVnode, el);
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
        // 简单DIFF

        const oldChildren = n1.children;
        const newChildren = n2.children;

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
      } else {
        setElementText(container, "");
        n2.children.forEach((child) => {
          patch(undefined, child, container);
        });
      }
    }
  }

  return { render };
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

const renderer = createRenderer({
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

const vnode: VNode = {
  type: "div",
  children: [
    { type: "p", children: "1", key: "1" },
    { type: "p", children: "2", key: "2" },
    { type: "p", children: "3", key: "3" },
  ],
};

const vnode2: VNode = {
  type: "div",
  children: [
    { type: "p", children: "new 3", key: "3" },
    { type: "p", children: "new 1", key: "1" },
  ],
};

renderer.render(vnode, document.getElementById("app")!);

setTimeout(() => {
  renderer.render(vnode2, document.getElementById("app")!);
}, 2000);
