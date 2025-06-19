import MyComponent from "./my-component";
import { ref } from "../reactive";
import {
  Comment,
  ComponentOptions,
  onUnmounted,
  renderer,
  VNode,
} from "../renderer";

type Loader = () => Promise<ComponentOptions>;

interface DefineAsyncComponentOptions {
  loader: Loader;
  timeout?: number;
  errorComponent?: ComponentOptions;
  delay?: number;
  loadingComponent?: ComponentOptions;
  // 重试机制
  onError?: (retry: () => void, fail: () => void, retries: number) => void;
}

function defineAsyncComponent(
  options: Loader | DefineAsyncComponentOptions,
): ComponentOptions {
  const opt = typeof options === "function" ? { loader: options } : options;
  const { loader } = opt;

  let retries = 0;
  function load() {
    return loader().catch((err) => {
      if (opt.onError) {
        return new Promise((resolve, reject) => {
          const retry = () => {
            resolve(load());
            retries++;
          };
          const fail = () => reject(err);

          opt.onError!(retry, fail, retries);
        });
      } else {
        throw err;
      }
    });
  }

  let InnerComp;

  return {
    name: "AsyncComponentWrapper",
    props: {},
    setup() {
      const loaded = ref(false);
      // 应该用shallowRef
      const error = ref<Error | null>(null);

      const loading = ref(false);

      let loadingTimer;
      if (opt.delay) {
        loadingTimer = setTimeout(() => {
          loading.value = true;
        }, opt.delay);
      } else {
        loading.value = true;
      }

      load()
        .then((c) => {
          InnerComp = c;
          loaded.value = true;
        })
        .catch((err) => {
          error.value = err;
        })
        .finally(() => {
          loading.value = false;
          clearTimeout(loadingTimer);
        });

      let timer;
      if (opt.timeout) {
        timer = setTimeout(() => {
          error.value = new Error(`${opt.timeout}ms后，请求超时`);
        }, opt.timeout);
      }

      onUnmounted(() => {
        clearTimeout(timer);
        clearTimeout(loadingTimer);
      });

      return () => {
        const placeholder = { type: Comment, children: "" };

        if (loaded.value) {
          return { type: InnerComp, props: {} };
        } else if (error.value && opt.errorComponent) {
          return { type: opt.errorComponent, props: { error: error.value } };
        } else if (loading.value && opt.loadingComponent) {
          return { type: opt.loadingComponent, props: {} };
        }
        return placeholder;
      };
    },
  };
}

export function main() {
  function loadComp() {
    console.log("8");
    return new Promise<ComponentOptions>((resolve, reject) => {
      setTimeout(() => {
        // resolve(MyComponent);
        reject(new Error("哈哈哈"));
      }, 2000);
    });
  }

  //   const MyComponentAsync = defineAsyncComponent({
  //     loader: () => import("./my-component").then((mod) => mod.default),
  //   });
  const MyComponentAsync = defineAsyncComponent({
    loader: () => loadComp(),
    // timeout: 1000,
    errorComponent: {
      props: { error: Object },
      render() {
        return {
          type: "p",
          children: `加载出错：${this.error.message}`,
        };
      },
    },
    delay: 500,
    loadingComponent: {
      props: {},
      render() {
        return { type: "h2", children: "加载中" };
      },
    },
    onError(retry, fail, retries) {
      if (retries < 3) {
        retry();
      } else {
        fail();
      }
    },
  });

  const vnode: VNode = {
    type: MyComponentAsync,
    props: {},
  };

  renderer.render(vnode, document.getElementById("app")!);
}
