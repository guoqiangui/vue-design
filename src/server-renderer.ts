import { ref, shallowReadonly } from "./reactive";
import {
  ComponentInstance,
  ComponentOptions,
  renderer,
  resolveProps,
  setCurrentInstance,
  SetupContext,
  Slots,
  VNode,
} from "./renderer";

const BOOLEAN_ATTRS =
  "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly" +
  ",async,autofocus,autoplay,controls,default,defer,disabled,hidden," +
  "loop,open,required,reversed,scoped,seamless," +
  "checked,muted,multiple,selected".split(",");

const SHOULD_IGNORE_PROP = ["ref", "key"];

function escapeHTML(str: unknown) {
  const content = "" + str;
  let ret = "";

  const match = /["'&<>]/.exec(content);

  if (!match) return content;

  if (match) {
    ret += content.slice(0, match.index);

    for (let i = match.index; i < content.length; i++) {
      let escaped;

      switch (content.charCodeAt(i)) {
        case 34:
          escaped = "&quot;";
          break;
        case 38:
          escaped = "&amp;";
          break;
        case 39:
          escaped = "&#39;";
          break;
        case 60:
          escaped = "&lt;";
          break;
        case 62:
          escaped = "&gt;";
          break;

        default:
          escaped = content[i];
          break;
      }

      ret += escaped;
    }
  }

  return ret;
}

function renderAttrs(props: { [name: string]: unknown }) {
  let ret = "";

  Object.keys(props).forEach((key) => {
    if (SHOULD_IGNORE_PROP.includes(key) || /^on[a-z]/i.test(key)) return;

    const isSSRSafeAttrName =
      !/[\u0020\u0022\u0027\u003e\u002f\u003d\t\n\f]/.test(key);

    if (!isSSRSafeAttrName) {
      console.warn(
        `[@vue/server-renderer] Skipped rendering unsafe attributes name ${key}`,
      );
      return;
    }

    const isBooleanAttr = BOOLEAN_ATTRS.includes(key);

    if (isBooleanAttr) {
      ret += props[key] ? ` ${key}` : "";
    } else {
      ret += ` ${key}="${escapeHTML(props[key])}"`;
    }
  });

  return ret;
}

const VOID_TAGS =
  "area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr".split(
    ",",
  );

function renderElementVNode(vnode: VNode) {
  const tag = vnode.type as string;

  let ret = `<${tag}`;

  if (vnode.props) {
    ret += renderAttrs(vnode.props);
  }

  /**
   * 是自闭合标签
   */
  const isVoidElement = VOID_TAGS.includes(tag);

  ret += isVoidElement ? " />" : ">";

  if (isVoidElement) return ret;

  if (typeof vnode.children === "string") {
    ret += vnode.children;
  } else if (Array.isArray(vnode.children)) {
    vnode.children.forEach((c) => {
      ret += renderVNode(c);
    });
  }

  ret += `</${tag}>`;

  return ret;
}

/**
 * 将组件类型的vnode渲染成html字符串，和mountComponent逻辑几乎一致，只是不需要响应式了
 * @param vnode
 * @returns
 */
function renderComponentVNode(vnode: VNode) {
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
    setup,
  } = componentOptions;
  let { render } = componentOptions;

  beforeCreate?.();

  const [props, attrs] = resolveProps(propsOption, vnode.props);

  const state = data ? data() : null;

  const instance: ComponentInstance = {
    state,
    props,
    isMounted: false,
    subTree: undefined,
    mounted: [],
    unmounted: [],
  };

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
    get(target, p) {
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
    set(target, p, newValue) {
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

  if (!render) throw new Error("你干嘛，没有render选项，setup也没返回渲染函数");

  const subTree = render.call(renderContext, renderContext);

  return renderVNode(subTree);
}

/**
 * 将vnode渲染成html字符串
 * @param vnode
 * @returns
 */
function renderVNode(vnode: VNode) {
  const type = typeof vnode.type;

  if (type === "string") {
    return renderElementVNode(vnode);
  } else if (type === "object" || type === "function") {
    return renderComponentVNode(vnode);
  } // 省略其他若干类型
}

export function main() {
  const vnode: VNode = {
    type: "div",
    props: { id: "foo", "a>b": "ff", key: 1 },
    children: [
      {
        type: "p",
        props: { unsafe: "<123>'" },
        children: "hello",
      },
      { type: "input", props: { type: "text", disabled: true } },
    ],
  };

  console.log(renderElementVNode(vnode));

  const Comp: ComponentOptions = {
    name: "App",
    props: {},
    setup() {
      const str = ref("foo");

      return () => {
        return {
          type: "div",
          children: [
            {
              type: "span",
              props: { onClick: () => (str.value = "bar") },
              children: str.value,
            },
            { type: "span", children: "baz" },
            { type: Comp2, props: {} },
          ],
        };
      };
    },
  };

  const Comp2: ComponentOptions = {
    props: {},
    setup() {
      return () => {
        return { type: "h3", children: "another component" };
      };
    },
  };

  const vnode2: VNode = {
    type: Comp,
    props: {},
  };

  const html = renderComponentVNode(vnode2);
  const container = document.getElementById("app")!;
  container.innerHTML = html;

  renderer.hydrate(vnode2, container);
}
