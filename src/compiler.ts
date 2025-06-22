import { ElementASTNode, parse, RootASTNode, TemplateASTNode } from "./parser";
import { effect, ref } from "./reactive";
import { Fragment, renderer, VNode } from "./renderer";

function dump(node: TemplateASTNode, indent = 0) {
  const desc =
    node.type === "Root"
      ? ""
      : node.type === "Element"
        ? node.tag
        : node.content;

  console.log(`${"-".repeat(indent)}${node.type}:${desc}`);

  if (node.type === "Root" || node.type === "Element") {
    node.children.forEach((c) => {
      dump(c, indent + 2);
    });
  }
}

type OnExit = () => void;

interface TransformContext {
  currentNode: TemplateASTNode | null;
  /**
   * 当前节点在父节点的children中的索引
   */
  childIndex: number;
  parent: RootASTNode | ElementASTNode | null;
  nodeTransforms: ((
    node: TemplateASTNode,
    context: TransformContext,
  ) => OnExit | void)[];
  replaceNode: (node: TemplateASTNode) => void;
  removeNode: () => void;
}

function traverseNode(node: TemplateASTNode, context: TransformContext) {
  const currentNode = node;
  context.currentNode = currentNode;

  const exitFns: OnExit[] = [];

  for (let i = 0; i < context.nodeTransforms.length; i++) {
    const onExit = context.nodeTransforms[i](currentNode, context);
    if (onExit) {
      exitFns.push(onExit);
    }

    // 当前节点有可能被转换函数移除
    if (!context.currentNode) return;
  }

  if (currentNode.type === "Root" || currentNode.type === "Element") {
    const children = currentNode.children;
    context.parent = currentNode;

    for (let i = 0; i < children.length; i++) {
      context.childIndex = i;
      traverseNode(children[i], context);
    }
  }

  // 反序执行
  for (let i = exitFns.length - 1; i >= 0; i--) {
    exitFns[i]();
  }
}

export interface StringLiteralNode {
  type: "StringLiteral";
  value: string;
}

interface IdentifierNode {
  type: "Identifier";
  name: string;
}

export interface CallExpressionNode {
  type: "CallExpression";
  callee: IdentifierNode;
  arguments: JsASTNode[];
}

interface ArrayExpressionNode {
  type: "ArrayExpression";
  elements: JsASTNode[];
}

export interface FunctionDeclNode {
  type: "FunctionDecl";
  id: IdentifierNode;
  params: [];
  body: [ReturnStatementNode];
}

interface ReturnStatementNode {
  type: "ReturnStatement";
  return: JsASTNode;
}

type JsASTNode =
  | StringLiteralNode
  | IdentifierNode
  | CallExpressionNode
  | ArrayExpressionNode
  | FunctionDeclNode
  | ReturnStatementNode;

function createStringLiteral(value: string): StringLiteralNode {
  return { type: "StringLiteral", value };
}

function createIdentifier(name: string): IdentifierNode {
  return { type: "Identifier", name };
}

function createArrayExpression(elements: JsASTNode[]): ArrayExpressionNode {
  return { type: "ArrayExpression", elements };
}

function createCallExpression(
  callee: string,
  args: JsASTNode[],
): CallExpressionNode {
  return {
    type: "CallExpression",
    callee: createIdentifier(callee),
    arguments: args,
  };
}

function transformElement(node: TemplateASTNode) {
  return () => {
    if (node.type === "Element") {
      node.jsNode = createCallExpression("h", [
        createStringLiteral(node.tag),
        node.children.length === 1
          ? node.children[0].jsNode!
          : createArrayExpression(node.children.map((n) => n.jsNode!)),
      ]);
    }
  };
}

function transformText(node: TemplateASTNode) {
  if (node.type === "Text") {
    node.jsNode = createStringLiteral(node.content);
  }
}

function transformRoot(node: TemplateASTNode) {
  return () => {
    if (node.type === "Root") {
      node.jsNode = {
        type: "FunctionDecl",
        id: createIdentifier("render"),
        params: [],
        body: [
          {
            type: "ReturnStatement",
            return: node.children[0].jsNode!,
          },
        ],
      };
    }
  };
}

function transform(ast: RootASTNode) {
  const context: TransformContext = {
    currentNode: null,
    childIndex: 0,
    parent: null,
    nodeTransforms: [transformRoot, transformElement, transformText],
    replaceNode: (node) => {
      if (context.parent) {
        context.parent.children[context.childIndex] = node;
      }

      context.currentNode = node;
    },
    removeNode: () => {
      if (context.parent) {
        context.parent.children.splice(context.childIndex, 1);
      }

      context.currentNode = null;
    },
  };

  traverseNode(ast, context);
  dump(ast);
}

interface GenerateContext {
  code: string;
  currentIndent: number;
  newline: () => void;
  indent: () => void;
  deIndent: () => void;
  push: (str: string) => void;
}

function genFunctionDecl(node: FunctionDeclNode, context: GenerateContext) {
  context.push(`function ${node.id.name}() {`);
  context.indent();
  node.body.forEach((n, i) => {
    genNode(n, context);

    if (i < node.body.length - 1) {
      context.newline();
    }
  });
  context.deIndent();
  context.push("}");
}

function genReturnStatement(
  node: ReturnStatementNode,
  context: GenerateContext,
) {
  context.push("return ");
  genNode(node.return, context);
}

function genCallExpression(node: CallExpressionNode, context: GenerateContext) {
  context.push(`${node.callee.name}(`);
  genNodeList(node.arguments, context);
  context.push(")");
}

function genStringLiteral(node: StringLiteralNode, context: GenerateContext) {
  context.push(`'${node.value}'`);
}

function genArrayExpression(
  node: ArrayExpressionNode,
  context: GenerateContext,
) {
  context.push("[");
  genNodeList(node.elements, context);
  context.push("]");
}

/**
 * 生成节点代码，并在节点代码之间补充逗号，可用于数组字面量或者函数的参数
 * @param nodes
 * @param context
 */
function genNodeList(nodes: JsASTNode[], context: GenerateContext) {
  for (let i = 0; i < nodes.length; i++) {
    genNode(nodes[i], context);

    if (i < nodes.length - 1) {
      context.push(", ");
    }
  }
}

function genNode(node: JsASTNode, context: GenerateContext) {
  const type = node.type;
  switch (type) {
    case "FunctionDecl":
      genFunctionDecl(node, context);
      break;

    case "ReturnStatement":
      genReturnStatement(node, context);
      break;

    case "CallExpression":
      genCallExpression(node, context);
      break;

    case "StringLiteral":
      genStringLiteral(node, context);
      break;

    case "ArrayExpression":
      genArrayExpression(node, context);
      break;

    default:
      break;
  }
}

function generate(jsAst: JsASTNode) {
  const context: GenerateContext = {
    code: "",
    currentIndent: 0,
    newline() {
      context.push(`\n${" ".repeat(context.currentIndent * 2)}`);
    },
    indent() {
      context.currentIndent++;
      context.newline();
    },
    deIndent() {
      context.currentIndent--;
      context.newline();
    },
    push(str) {
      context.code += str;
    },
  };

  genNode(jsAst, context);

  return context.code;
}

function compile(template: string) {
  const templateAST = parse(template);
  console.log(templateAST);

  dump(templateAST);

  transform(templateAST);

  const code = generate(templateAST.jsNode!);

  return code;
}

const dynamicChildrenStack: VNode[][] = [];
let currentDynamicChildren: VNode[] | null | undefined = null;

function openBlock() {
  dynamicChildrenStack.push((currentDynamicChildren = []));
}

function closeBlock() {
  dynamicChildrenStack.pop();
  currentDynamicChildren = dynamicChildrenStack.at(-1);
}

function createBlock(
  type: VNode["type"],
  props: { [key: string]: unknown },
  children,
) {
  const vnode = createVNode(type, props, children);

  vnode.dynamicChildren = currentDynamicChildren!;

  const parentDynamicChildren = dynamicChildrenStack.at(-2);
  if (parentDynamicChildren) {
    parentDynamicChildren.push(vnode);
  }

  closeBlock();

  return vnode;
}

function createVNode(
  type: VNode["type"],
  props: { [key: string]: unknown },
  children,
  flags?,
): VNode {
  const key = props.key;
  delete props.key;

  const vnode = {
    type,
    props,
    children,
    key,
    patchFlags: flags,
  };

  if (flags != null && currentDynamicChildren) {
    currentDynamicChildren.push(vnode);
  }

  return vnode;
}

export function main() {
  // const template = `<div><!-- 哈哈哈 --></div>`;
  // const code = compile(template);

  // console.log(code);

  const foo = ref(false);
  const a = ref("111");
  const list = ref(["1", "2"]);

  // 假如这是编译好的render函数，并已完成动态节点分析
  function render() {
    // 普通情况
    // return (
    //   openBlock(),
    //   createBlock("div", { class: "root" }, [
    //     createVNode("section", { class: "parent" }, [
    //       createVNode("p", {}, a.value, 1),
    //     ]),
    //   ])
    // );

    // v-if情况
    // return (
    //   openBlock(),
    //   createBlock("div", { class: "root" }, [
    //     foo.value
    //       ? (openBlock(),
    //         createBlock("section", { class: "parent", key: 1 }, [
    //           createVNode("p", {}, a.value, 1),
    //         ]))
    //       : (openBlock(),
    //         createBlock("div", { class: "parent", key: 2 }, [
    //           createVNode("p", {}, a.value, 1),
    //         ])),
    //   ])
    // );

    // v-for情况
    return (
      openBlock(),
      createBlock("div", {}, [
        (openBlock(),
        createBlock(
          Fragment,
          {},
          list.value.map((item) => createVNode("p", {}, item)),
        )),
        createVNode("i", {}, a.value),
      ])
    );
  }

  const Comp = {
    props: {},
    render,
  };

  renderer.render({ type: Comp, props: {} }, document.getElementById("app")!);

  setTimeout(() => {
    foo.value = !foo.value;
    a.value = "222";
    list.value = ["1"];
  }, 2000);
}
