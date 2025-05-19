// 原始数据
const data = { foo: 0, bar: 2 };

const bucket = new WeakMap<object, Map<PropertyKey, Set<EffectFunction>>>();
console.log("bucket", bucket);

function track(target: object, p: PropertyKey) {
  if (!activeEffect) return;

  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }

  let deps = depsMap.get(p);
  if (!deps) {
    depsMap.set(p, (deps = new Set()));
  }
  deps.add(activeEffect);

  activeEffect.deps.push(deps);
}

function trigger(target: object, p: PropertyKey) {
  const depsMap = bucket.get(target);
  if (!depsMap) return;

  const effects = depsMap.get(p);
  if (!effects) return;
  const effectsToRun = new Set<EffectFunction>();
  effects.forEach((effect) => {
    if (effect !== activeEffect) {
      effectsToRun.add(effect);
    }
  });
  effectsToRun.forEach((effect) => {
    if (effect.options.scheduler) {
      // 让用户决定何时执行
      effect.options.scheduler(effect);
    } else {
      effect();
    }
  });
}

const obj = new Proxy(data, {
  get(target, p, receiver) {
    track(target, p);
    return Reflect.get(target, p, receiver);
  },
  set(target, p, newValue, receiver) {
    const res = Reflect.set(target, p, newValue, receiver);
    trigger(target, p);
    return res;
  },
});

type EffectFunction = Function & {
  deps: Set<Function>[];
  options: EffectOptions;
};
type EffectOptions = {
  scheduler?: (fn: EffectFunction) => void;
  lazy?: boolean;
};

let activeEffect: EffectFunction | undefined;
const effectStack: EffectFunction[] = [];
// 注册副作用函数
function effect(fn: Function, options: EffectOptions = {}) {
  const effectFn = () => {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStack.push(effectFn);
    // 执行副作用函数，触发读取
    const res = fn();
    effectStack.pop();
    activeEffect = effectStack.at(-1);
    return res;
  };

  effectFn.deps = [];
  effectFn.options = options;

  if (!options.lazy) {
    effectFn();
  }
  return effectFn;
}

function cleanup(effectFn: EffectFunction) {
  effectFn.deps.forEach((deps) => {
    deps.delete(effectFn);
  });
  // 重置deps数组
  effectFn.deps.length = 0;
}

const jobQueue = new Set<EffectFunction>();
let isFlushing = false;
function flushJob() {
  if (isFlushing) return;

  isFlushing = true;
  Promise.resolve().then(() => {
    jobQueue.forEach((job) => job());
    isFlushing = false;
  });
}

function computed(getter: Function) {
  let dirty = true;
  let value;

  const effectFn = effect(getter, {
    lazy: true,
    scheduler() {
      dirty = true;
      // 手动触发
      trigger(obj, "value");
    },
  });

  const obj = {
    get value() {
      if (dirty) {
        value = effectFn();
        dirty = false;
      }

      // 手动追踪依赖
      track(obj, "value");
      return value;
    },
  };

  return obj;
}

function traverse(value, seen = new Set<object>()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  // 避免循环引用
  seen.add(value);
  Object.keys(value).forEach((key) => {
    traverse(value[key], seen);
  });
  return value;
}

type WatchOptions = { immediate?: boolean; flush?: "pre" | "post" | "sync" };

/**
 *
 * @param source 响应式数据或getter
 * @param cb
 */
function watch<T>(
  source: T | (() => T),
  cb: (newVal: T, oldVal: T, onInvalidate: (fn: Function) => void) => void,
  options: WatchOptions = {}
) {
  let getter: Function;
  if (typeof source == "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  let cleanup: Function;
  // 注册过期回调
  const onInvalidate = (fn: Function) => {
    cleanup = fn;
  };

  const job = () => {
    newValue = effectFn();
    // 调用回调函数之前，先调用过期回调
    if (cleanup) {
      cleanup();
    }
    cb(newValue, oldValue, onInvalidate);
    oldValue = newValue;
  };

  let oldValue, newValue;
  const effectFn = effect(getter, {
    scheduler() {
      if (options.flush === "post") {
        Promise.resolve().then(job);
      } else {
        job();
      }
    },
    lazy: true,
  });

  if (options.immediate) {
    job();
  } else {
    oldValue = effectFn();
  }
}

const fetchData = () => {
  const fetchA = () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve("数据A");
      }, 1000);
    });
  };

  const fetchB = () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve("数据B");
      }, 200);
    });
  };

  return obj.foo === 1 ? fetchA() : fetchB();
};

watch(obj, async (newVal, oldVal, onInvalidate) => {
  let expired = false;
  onInvalidate(() => {
    expired = true;
  });

  const res = await fetchData(); // 最后期望是数据B
  if (!expired) {
    window.finalData = res;
  }
});

obj.foo++;
obj.foo++;
