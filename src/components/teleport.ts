import { ComponentOptions, renderer, VNode } from "../renderer";

const Teleport: ComponentOptions = {
  __isTeleport: true,
  props: { to: String },
  process(n1, n2, container, anchor, { patch, patchChildren, move }) {
    const to = n2.props!.to;
    const target = typeof to === "string" ? document.querySelector(to) : to;
    const children = n2.children as VNode[];

    if (!n1) {
      children.forEach((c) => patch(null, c, target, anchor));
    } else {
      patchChildren(n1, n2, container);

      if (n1.props!.to !== to) {
        children.forEach((c) => move(c, target));
      }
    }
  },
};

// Teleport解析成vnode，和普通组件不一样，子组件放在children，而不是插槽
const vnode: VNode = {
  type: Teleport,
  props: { to: "body" },
  children: [
    { type: "h3", children: "哈哈哈" },
    { type: "p", children: "好好好" },
  ],
};

const vnode2: VNode = {
  type: Teleport,
  props: { to: "#app" },
  children: [
    { type: "h3", children: "哈哈哈2" },
    { type: "p", children: "好好好2" },
  ],
};

export function main() {
  renderer.render(vnode, document.getElementById("app")!);

  setTimeout(() => {
    renderer.render(vnode2, document.getElementById("app")!);
  }, 2000);
}
