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

  function patch(oldVnode: VNode | undefined, newVnode: VNode, container) {
    if (oldVnode && oldVnode.type !== newVnode.type) {
      unmount(oldVnode);
      oldVnode = undefined;
    }

    const { type } = newVnode;

    if (typeof type === "string") {
      if (!oldVnode) {
        mountElement(newVnode, container);
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

  function mountElement(vnode: VNode, container) {
    if (typeof vnode.type === "string") {
      const el = (vnode.el = createElement(vnode.type));

      if (vnode.props) {
        Object.keys(vnode.props).forEach((key) => {
          const value = vnode.props[key];
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
      insert(el, container);
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

  function patchChildren(oldVnode: VNode, newVnode: VNode, container) {
    if (!newVnode.children) {
      if (typeof oldVnode.children === "string") {
        setElementText(container, "");
      } else if (Array.isArray(oldVnode.children)) {
        oldVnode.children.forEach((child) => unmount(child));
      }
    } else if (typeof newVnode.children === "string") {
      if (Array.isArray(oldVnode.children)) {
        oldVnode.children.forEach((child) => unmount(child));
      }
      setElementText(container, newVnode.children);
    } else {
      if (Array.isArray(oldVnode.children)) {
        // 应该是DIFF算法，这里简单处理
        oldVnode.children.forEach((child) => unmount(child));
        newVnode.children.forEach((child) => {
          patch(undefined, child, container);
        });
      } else {
        setElementText(container, "");
        newVnode.children.forEach((child) => {
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
  type: Fragment,
  children: [
    { type: "li", children: "1" },
    { type: "li", children: "2" },
    { type: "li", children: "3" },
  ],
};

const vnode2: VNode = {
  type: Fragment,
  children: [
    { type: "li", children: "4" },
    { type: "li", children: "5" },
    { type: "li", children: "6" },
  ],
};

renderer.render(vnode, document.getElementById("app")!);

setTimeout(() => {
  renderer.render(vnode2, document.getElementById("app")!);
}, 2000);
