import { ComponentOptions } from "./renderer";

const MyComponent: ComponentOptions = {
  props: {},
  setup() {
    return () => ({
      type: "div",
      children: `妙啊`,
    });
  },
};

export default MyComponent;
