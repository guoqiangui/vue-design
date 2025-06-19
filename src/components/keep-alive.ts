import { ref } from "../reactive";
import {
  ComponentOptions,
  getCurrentInstance,
  renderer,
  VNode,
} from "../renderer";

const KeepAlive: ComponentOptions = {
  __isKeepAlive: true,
  props: {
    include: RegExp,
    exclude: RegExp,
    max: Number,
  },
  setup(props, { slots }) {
    const cache = new Map<ComponentOptions, VNode>();
    let latestKey;

    const instance = getCurrentInstance();

    if (!instance || !instance.keepAliveCtx) return () => {};

    const { move, createElement } = instance.keepAliveCtx;

    // 创建隐藏容器
    const storageContainer = createElement("div");

    instance._activate = (vnode, container, anchor) => {
      move(vnode, container, anchor);
    };
    instance._deActivate = (vnode: VNode) => {
      move(vnode, storageContainer);
    };

    return () => {
      const rawVnode = slots.default();
      const type = rawVnode.type as ComponentOptions;
      if (typeof type !== "object") {
        // 非组件直接渲染
        return rawVnode;
      }

      if (
        type.name &&
        ((props.include && !props.include.test(type.name)) ||
          (props.exclude && props.exclude.test(type.name)))
      ) {
        return rawVnode;
      }

      const cachedVNode = cache.get(type);

      if (cachedVNode) {
        rawVnode.component = cachedVNode.component;
        rawVnode.keptAlive = true;
      } else {
        if (props.max && cache.size >= props.max) {
          // 需要控制缓存数量
          let numNeedDelete = cache.size - (props.max - 1);
          const keysToDelete: ComponentOptions[] = [];

          for (const [key] of cache) {
            // 最新渲染的不能被删除
            if (latestKey === key) continue;

            if (numNeedDelete > 0) {
              keysToDelete.push(key);
              numNeedDelete--;
            } else {
              break;
            }
          }

          keysToDelete.forEach((key) => {
            cache.delete(key);
          });
        }

        cache.set(type, rawVnode);
      }

      rawVnode.shouldKeepAlive = true;
      rawVnode.keepAliveInstance = instance;

      latestKey = type;

      return rawVnode;
    };
  },
};

export function main() {
  const Comp1: ComponentOptions = {
    name: "c1",
    props: {},
    render() {
      return { type: "input" };
    },
  };
  const Comp2: ComponentOptions = {
    name: "c2",
    props: {},
    render() {
      return { type: "input", props: { type: "checkbox" } };
    },
  };
  const Comp3: ComponentOptions = {
    name: "c3",
    props: {},
    render() {
      return { type: "h2", children: "333" };
    },
  };

  const App: ComponentOptions = {
    props: {},
    setup() {
      const activeIndex = ref(0);

      function onClick(index) {
        activeIndex.value = index;
      }

      const map = {
        0: Comp1,
        1: Comp2,
        2: Comp3,
      };

      return () => {
        const vnode: VNode = {
          type: "div",
          children: [
            {
              type: "p",
              children: `当前激活的索引：${activeIndex.value}`,
            },
            {
              type: "div",
              children: [1, 2, 3].map((item, index) => {
                return {
                  key: item,
                  type: "a",
                  props: {
                    href: "javascript:;",
                    onClick: () => onClick(index),
                  },
                  children: `to ${item}`,
                };
              }),
            },
            // {
            //   type: map[activeIndex.value],
            //   props: {},
            // },
            {
              type: KeepAlive,
              props: {
                /* exclude: /c1/, */
                max: 2,
              },
              children: {
                default: () => ({
                  type: map[activeIndex.value],
                  props: {},
                }),
              },
            },
          ],
        };

        return vnode;
      };
    },
  };

  renderer.render({ type: App, props: {} }, document.getElementById("app")!);
}
