export type VNode = {
  tag: string | { render: () => VNode };
  props?: Record<string, any>;
  children?: string | VNode[];
};

function mountElement(vnode: VNode, container: HTMLElement) {
  const el: HTMLElement = document.createElement(vnode.tag);

  Object.keys(vnode.props).forEach((key) => {
    if (key.startsWith("on")) {
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, vnode.props[key]);
    } else {
      el.setAttribute(key, vnode.props[key]);
    }
  });

  if (typeof vnode.children === "string") {
    el.appendChild(document.createTextNode(vnode.children));
  } else {
    vnode.children.forEach((child) => {
      renderer(child, el);
    });
  }

  container.appendChild(el);
}

function mountComponent(vnode: VNode, container: HTMLElement) {
  const subtree = vnode.tag.render();
  renderer(subtree, container);
}

export function renderer(vnode: VNode, container: HTMLElement) {
  if (typeof vnode.tag === "string") {
    mountElement(vnode, container);
  } else if (typeof vnode.tag === "object") {
    mountComponent(vnode, container);
  }
}

export function main() {
  const vnode: VNode = {
    tag: "div",
    props: {
      onClick: () => {
        alert("Hello, world!");
      },
    },
    children: "cilck me",
  };

  const MyComponent = {
    render() {
      return {
        tag: "div",
        props: {
          onClick: () => {
            alert("I'm Component!");
          },
        },
        children: "click me too",
      };
    },
  };

  const vnode2: VNode = {
    tag: MyComponent,
  };

  renderer(vnode2, document.getElementById("app")!);
}
