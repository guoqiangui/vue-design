const bucket = new WeakMap<object, Map<PropertyKey, Set<EffectFunction>>>();
console.log("bucket", bucket);

function track(target: object, p: PropertyKey) {
  if (!activeEffect || !shouldTrack) return;

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

const triggerType = {
  ADD: "ADD",
  SET: "SET",
  DELETE: "DELETE",
} as const;

function trigger(
  target: object,
  p: PropertyKey,
  type: (typeof triggerType)[keyof typeof triggerType] = triggerType.SET,
  newValue?: any
) {
  const depsMap = bucket.get(target);
  if (!depsMap) return;

  const effectsToRun = new Set<EffectFunction>();

  const effects = depsMap.get(p);
  effects &&
    effects.forEach((effect) => {
      if (effect !== activeEffect) {
        effectsToRun.add(effect);
      }
    });

  if (
    type === triggerType.ADD ||
    type === triggerType.DELETE ||
    (type === triggerType.SET &&
      Object.prototype.toString.call(target) === "[object Map]")
  ) {
    // 新增或删除属性的时候触发与ITERATE_KEY相关联的副作用
    // 当target是Map的时候，即使是SET类型也要触发
    const iterateEffects = depsMap.get(ITERATE_KEY);
    iterateEffects &&
      iterateEffects.forEach((effect) => {
        if (effect !== activeEffect) {
          effectsToRun.add(effect);
        }
      });
  }

  if (
    (type === triggerType.ADD || type === triggerType.DELETE) &&
    Object.prototype.toString.call(target) === "[object Map]"
  ) {
    const mapKeyIterateEffects = depsMap.get(MAP_KEY_ITERATE_KEY);
    mapKeyIterateEffects &&
      mapKeyIterateEffects.forEach((effect) => {
        if (effect !== activeEffect) {
          effectsToRun.add(effect);
        }
      });
  }

  if (Array.isArray(target) && type === triggerType.ADD) {
    const lengthEffects = depsMap.get("length");
    lengthEffects &&
      lengthEffects.forEach((effect) => {
        if (effect !== activeEffect) {
          effectsToRun.add(effect);
        }
      });
  }

  if (Array.isArray(target) && p === "length") {
    depsMap.forEach((effects, key) => {
      if ((key as number) >= newValue) {
        effects.forEach((effect) => {
          if (effect !== activeEffect) {
            effectsToRun.add(effect);
          }
        });
      }
    });
  }

  effectsToRun.forEach((effect) => {
    if (effect.options.scheduler) {
      // 让用户决定何时执行
      effect.options.scheduler(effect);
    } else {
      effect();
    }
  });
}

const ITERATE_KEY = Symbol("ITERATE_KEY");
const MAP_KEY_ITERATE_KEY = Symbol("MAP_KEY_ITERATE_KEY");

const arrayInstrumentations = {};

["includes", "indexOf", "lastIndexOf"].forEach((method) => {
  const originMethod = Array.prototype[method];

  arrayInstrumentations[method] = function (...args) {
    let res = originMethod.apply(this, args);
    if (!res || res === -1) {
      res = originMethod.apply(this.raw, args);
    }
    return res;
  };
});

let shouldTrack = true;
["push", "pop", "shift", "unshift", "splice"].forEach((method) => {
  arrayInstrumentations[method] = function (...args) {
    const originMethod = Array.prototype[method];
    shouldTrack = false;
    const res = originMethod.apply(this, args);
    shouldTrack = true;
    return res;
  };
});

const wrap = (val) =>
  typeof val === "object" && val !== null ? reactive(val) : val;

function iterationMethod() {
  const target = this.raw;
  const iter = target[Symbol.iterator]();

  track(target, ITERATE_KEY);
  return {
    next: () => {
      const { value, done } = iter.next();
      return {
        value: value ? [wrap(value[0]), wrap(value[1])] : value,
        done,
      };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}

function valuesIterationMethod() {
  const target = this.raw;
  const iter = target.values();
  track(target, ITERATE_KEY);
  return {
    next: () => {
      const { value, done } = iter.next();
      return {
        value: value ? wrap(value) : value,
        done,
      };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}

function keysIterationMethod() {
  const target = this.raw;
  const iter = target.keys();
  track(target, MAP_KEY_ITERATE_KEY);
  return {
    next: () => {
      const { value, done } = iter.next();
      return {
        value: value ? wrap(value) : value,
        done,
      };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}

const mutableInstrumentations = {
  add(key) {
    const target = this.raw;
    const hadKey = target.has(key);
    const res = target.add(key);
    if (!hadKey) {
      trigger(target, key, triggerType.ADD);
    }
    return res;
  },
  delete(key) {
    const target = this.raw;
    const hadKey = target.has(key);
    const res = target.delete(key);
    if (hadKey) {
      trigger(target, key, triggerType.DELETE);
    }
    return res;
  },
  get(key) {
    const target = this.raw;
    const hadKey = target.has(key);
    track(target, key);
    if (hadKey) {
      const res = target.get(key);
      return typeof res === "object" ? reactive(res) : res;
    }
  },
  set(key, value) {
    const target = this.raw;
    const hadKey = target.has(key);
    const oldValue = target.get(key);
    const res = target.set(key, value.raw || value);

    if (!hadKey) {
      trigger(target, key, triggerType.ADD);
    } else if (
      value !== oldValue &&
      (value === value || oldValue === oldValue)
    ) {
      trigger(target, key, triggerType.SET);
    }
    return res;
  },
  forEach(callback, thisArg) {
    const target = this.raw;
    track(target, ITERATE_KEY);

    target.forEach((value, key) => {
      callback.call(thisArg, wrap(value), wrap(key), this);
    });
  },
  [Symbol.iterator]: iterationMethod,
  entries: iterationMethod,
  values: valuesIterationMethod,
  keys: keysIterationMethod,
};

function createReactive(
  obj: Record<PropertyKey, any>,
  isShallow = false,
  isReadonly = false
) {
  if (
    ["[object Set]", "[object Map]"].includes(
      Object.prototype.toString.call(obj)
    )
  ) {
    return new Proxy(obj, {
      get(target, p, receiver) {
        if (p === "raw") {
          return target;
        }

        if (p === "size") {
          track(target, ITERATE_KEY);
          return Reflect.get(target, p, target);
        }

        return mutableInstrumentations[p];
      },
    });
  }

  return new Proxy(obj, {
    get(target, p, receiver) {
      // 代理对象可以通过raw属性访问原始对象
      if (p === "raw") {
        return target;
      }

      if (
        Array.isArray(target) &&
        Object.prototype.hasOwnProperty.call(arrayInstrumentations, p)
      ) {
        return Reflect.get(arrayInstrumentations, p, receiver);
      }

      // 只读的数据证明没有办法修改它，所以没必要追踪
      // for of会读取@@iterator属性，没必要追踪@@iterator
      if (!isReadonly && typeof p !== "symbol") {
        track(target, p);
      }

      const res = Reflect.get(target, p, receiver);

      if (isShallow) {
        return res;
      }

      if (typeof res === "object" && res !== null) {
        // 深响应、深只读
        return isReadonly ? readonly(res) : reactive(res);
      }
      return res;
    },
    set(target, p, newValue, receiver) {
      if (isReadonly) {
        console.warn(`${p.toString()}是只读的`);
        return true;
      }

      const oldValue = target[p];

      const type = Array.isArray(target)
        ? Number(p) >= target.length
          ? triggerType.ADD
          : triggerType.SET
        : Object.prototype.hasOwnProperty.call(target, p)
        ? triggerType.SET
        : triggerType.ADD;

      const res = Reflect.set(target, p, newValue, receiver);

      // 判断receiver是否为target的代理对象
      if (receiver.raw === target) {
        // 值发生变化了才触发（并处理NaN情形）
        if (
          newValue !== oldValue &&
          (newValue === newValue || oldValue === oldValue)
        ) {
          trigger(target, p, type, newValue);
        }
      }

      return res;
    },
    has(target, p) {
      // 拦截 in操作
      track(target, p);
      return Reflect.has(target, p);
    },
    ownKeys(target) {
      // 拦截for in
      track(target, Array.isArray(target) ? "length" : ITERATE_KEY);
      return Reflect.ownKeys(target);
    },
    deleteProperty(target, p) {
      // 拦截delete操作
      if (isReadonly) {
        console.warn(`${p.toString()}是只读的`);
        return true;
      }

      const hadKey = Object.prototype.hasOwnProperty.call(target, p);
      const res = Reflect.deleteProperty(target, p);
      if (res && hadKey) {
        trigger(target, p, triggerType.DELETE);
      }
      return res;
    },
  });
}

const reactiveMap = new Map();
function reactive(obj: Record<PropertyKey, any>) {
  const existionProxy = reactiveMap.get(obj);
  if (existionProxy) {
    return existionProxy;
  }
  const proxy = createReactive(obj);
  reactiveMap.set(obj, proxy);
  return proxy;
}

function shallowReactive(obj: Record<PropertyKey, any>) {
  return createReactive(obj, true);
}

function readonly(obj: Record<PropertyKey, any>) {
  return createReactive(obj, false, true);
}

function shallowReadonly(obj: Record<PropertyKey, any>) {
  return createReactive(obj, true, true);
}

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
export function effect(fn: Function, options: EffectOptions = {}) {
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

export function ref(value) {
  const wrapper = { value };
  Object.defineProperty(wrapper, "__v_isRef", { value: true });
  return reactive(wrapper);
}

function toRef(obj: object, key: PropertyKey) {
  const wrapper = {
    get value() {
      return obj[key];
    },
    set value(val) {
      obj[key] = val;
    },
  };
  Object.defineProperty(wrapper, "__v_isRef", { value: true });
  return wrapper;
}

function toRefs(obj: object) {
  const newObj = {};
  Object.keys(obj).forEach((key) => {
    newObj[key] = toRef(obj, key);
  });
  return newObj;
}

// 自动脱ref
function proxyRefs(obj: object) {
  return new Proxy(obj, {
    get(target, p, receiver) {
      const value = Reflect.get(target, p, receiver);

      return value.__v_isRef ? value.value : value;
    },
    set(target, p, newValue, receiver) {
      const value = target[p];
      if (value.__v_isRef) {
        value.value = newValue;
        return true;
      }
      return Reflect.set(target, p, newValue, receiver);
    },
  });
}
