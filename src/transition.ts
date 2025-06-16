import { ref } from "./reactive";
import { ComponentOptions, renderer, VNode } from "./renderer";
import "./transition.css";

/**
 * dom版transition实现
 */
function domTransition() {
  const container = document.getElementById("app");

  const box = document.createElement("div");
  box.className = "box";

  box.classList.add("enter-from", "enter-active");

  container?.appendChild(box);

  nextFrame(() => {
    box.classList.remove("enter-from");
    box.classList.add("enter-to");

    box.addEventListener("transitionend", () => {
      box.classList.remove("enter-to", "enter-active");
    });
  });
}

function nextFrame(cb: Function) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cb();
    });
  });
}

const Transition: ComponentOptions = {
  name: "Transition",
  props: {},
  setup(props, { slots }) {
    return () => {
      const innerVnode = slots.default();

      innerVnode.transition = {
        beforeEnter(el) {
          el.classList.add("enter-from", "enter-active");
        },
        enter(el: HTMLElement) {
          nextFrame(() => {
            el.classList.remove("enter-from");
            el.classList.add("enter-to");

            el.addEventListener(
              "transitionend",
              () => {
                el.classList.remove("enter-to", "enter-active");
              },
              { once: true }
            );
          });
        },
        leave(el: HTMLElement, performRemove) {
          el.classList.add("leave-from", "leave-active");

          document.body.offsetHeight;

          nextFrame(() => {
            el.classList.remove("leave-from");
            el.classList.add("leave-to");

            el.addEventListener(
              "transitionend",
              () => {
                el.classList.remove("leave-to", "leave-active");

                performRemove();
              },
              { once: true }
            );
          });
        },
      };

      return innerVnode;
    };
  },
};

const MyComponent: ComponentOptions = {
  props: {},
  setup() {
    const hideBox = ref(false);

    const vnode: VNode = {
      type: Transition,
      props: {},
      children: {
        default() {
          return hideBox.value
            ? {}
            : {
                type: "div",
                props: { class: "box" },
              };
        },
      },
    };

    setTimeout(() => {
      hideBox.value = true;
    }, 2000);

    return () => {
      return vnode;
    };
  },
};

export function main() {
  renderer.render(
    { type: MyComponent, props: {} },
    document.getElementById("app")!
  );
}
