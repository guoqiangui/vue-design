import {
  CallExpressionNode,
  FunctionDeclNode,
  StringLiteralNode,
} from "./compiler";

const State = {
  initial: 1,
  tagOpen: 2,
  tagName: 3,
  text: 4,
  tagEnd: 5,
  tagEndName: 6,
};

/**
 * 判断给定字符是否为字母
 * @param char
 * @returns
 */
function isAlpha(char: string) {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

interface TagToken {
  type: "tag";
  name: string;
}

interface TextToken {
  type: "text";
  content: string;
}

interface TagEndToken {
  type: "tagEnd";
  name: string;
}

type Token = TagToken | TextToken | TagEndToken;

/**
 * 接受vue模板，将模板切割为token返回
 * @param str
 * @returns
 */
function tokenize(str: string) {
  const tokens: Token[] = [];
  const chars: string[] = [];
  let currentState = State.initial;

  while (str.length) {
    const char = str[0];

    switch (currentState) {
      case State.initial:
        if (char === "<") {
          currentState = State.tagOpen;
          str = str.slice(1);
        } else if (isAlpha(char)) {
          currentState = State.text;
          chars.push(char);
          str = str.slice(1);
        }
        break;

      case State.tagOpen:
        if (isAlpha(char)) {
          currentState = State.tagName;
          chars.push(char);
          str = str.slice(1);
        } else if (char === "/") {
          currentState = State.tagEnd;
          str = str.slice(1);
        }
        break;

      case State.tagName:
        if (isAlpha(char)) {
          chars.push(char);
          str = str.slice(1);
        } else if (char === ">") {
          currentState = State.initial;
          tokens.push({
            type: "tag",
            name: chars.join(""),
          });
          chars.length = 0;
          str = str.slice(1);
        }
        break;

      case State.text:
        if (isAlpha(char)) {
          chars.push(char);
          str = str.slice(1);
        } else if (char === "<") {
          currentState = State.tagOpen;
          tokens.push({
            type: "text",
            content: chars.join(""),
          });
          chars.length = 0;
          str = str.slice(1);
        }
        break;

      case State.tagEnd:
        if (isAlpha(char)) {
          currentState = State.tagEndName;
          chars.push(char);
          str = str.slice(1);
        }
        break;

      case State.tagEndName:
        if (isAlpha(char)) {
          chars.push(char);
          str = str.slice(1);
        } else if (char === ">") {
          currentState = State.initial;
          tokens.push({
            type: "tagEnd",
            name: chars.join(""),
          });
          chars.length = 0;
          str = str.slice(1);
        }
        break;

      default:
        break;
    }
  }

  return tokens;
}

export interface RootASTNode {
  type: "Root";
  children: TemplateASTNode[];
  jsNode?: FunctionDeclNode;
}

export interface ElementASTNode {
  type: "Element";
  tag: string;
  isSelfClosing: boolean;
  props: AttributeASTNode[];
  children: TemplateASTNode[];
  jsNode?: CallExpressionNode;
}

interface TextASTNode {
  type: "Text";
  content: string;
  jsNode?: StringLiteralNode;
}

interface AttributeASTNode {
  type: "Attribute";
  name: string;
  value: string;
}

interface InterpolationASTNode {
  type: "Interpolation";
  content: ExpressionASTNode;
}

interface ExpressionASTNode {
  type: "Expression";
  content: string;
}

interface CommentASTNode {
  type: "Comment";
  content: string;
}

export type TemplateASTNode = RootASTNode | ElementASTNode | TextASTNode;

/**
 * 接收vue模板，返回模板AST（此为简单的实现，有限状态自动机）
 * @param str
 */
export function parse1(str: string) {
  const tokens = tokenize(str);
  console.log(tokens);

  const root: RootASTNode = { type: "Root", children: [] };

  const elementStack: (RootASTNode | ElementASTNode)[] = [root];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const parent = elementStack[elementStack.length - 1];

    switch (token.type) {
      case "tag": {
        const node: ElementASTNode = {
          type: "Element",
          tag: token.name,
          isSelfClosing: false,
          props: [],
          children: [],
        };
        parent.children.push(node);
        elementStack.push(node);
        break;
      }
      case "text": {
        const node: TextASTNode = { type: "Text", content: token.content };
        parent.children.push(node);
        break;
      }
      case "tagEnd": {
        elementStack.pop();
        break;
      }
    }
  }

  return root;
}

const TextModes = {
  DATA: "DATA",
  RCDATA: "RCDATA",
  RAWTEXT: "RAWTEXT",
  CDATA: "CDATA",
} as const;

interface ParseContext {
  source: string;
  mode: (typeof TextModes)[keyof typeof TextModes];
  /**
   * 消费指定数量的字符
   * @param num
   * @returns
   */
  advanceBy: (num: number) => void;
  /**
   * 消费空白字符
   * @returns
   */
  advanceSpaces: () => void;
}

function isEnd(context: ParseContext, ancestors: ElementASTNode[]) {
  if (!context.source) return true;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (context.source.startsWith(`</${ancestors[i].tag}`)) {
      return true;
    }
  }

  return false;
}

function parseAttributes(context: ParseContext): AttributeASTNode[] {
  const props: AttributeASTNode[] = [];

  // 遇到>或/>才停止
  while (!/^(>|\/>)/.test(context.source)) {
    const match = /^[^\r\n\t\f />][^\r\n\t\f />=]*/.exec(context.source);
    if (match) {
      const name = match[0];
      let value;

      context.advanceBy(name.length);
      context.advanceSpaces();

      if (context.source[0] !== "=") {
        console.error("属性不合法");
      } else {
        // 消费=
        context.advanceBy(1);
        context.advanceSpaces();

        const quote = context.source[0];

        if (/["']/.test(quote)) {
          // 消费"或'
          context.advanceBy(1);
          // 获取下一个引号位置
          const endQuoteIndex = context.source.indexOf(quote);

          if (endQuoteIndex > -1) {
            value = context.source.slice(0, endQuoteIndex);
            context.advanceBy(value.length);

            // 消费"或'
            context.advanceBy(1);
          } else {
            console.error("缺少引号");
          }
        } else {
          // 没有被引号引用
          const valueMatch = /^[^\r\n\t\f >]+/i.exec(context.source);
          if (valueMatch) {
            value = valueMatch[0];
            context.advanceBy(valueMatch[0].length);
          }
        }
      }

      context.advanceSpaces();

      props.push({ type: "Attribute", name, value });
    }
  }

  return props;
}

function parseTag(
  context: ParseContext,
  type: "start" | "end" = "start",
): ElementASTNode {
  const isStart = type === "start";
  const reg = isStart
    ? /<([a-z][^\r\n\t\f />]*)/i
    : /<\/([a-z][^\r\n\t\f />]*)/i;

  const match = reg.exec(context.source)!;
  const tag = match[1];
  // 消费<tag或</tag
  context.advanceBy(match[0].length);
  context.advanceSpaces();

  const props = parseAttributes(context);

  const isSelfClosing = context.source.startsWith("/>");
  // 如果是自闭合，消费/>，否则消费>
  context.advanceBy(isSelfClosing ? 2 : 1);

  return {
    type: "Element",
    tag,
    isSelfClosing,
    props,
    children: [],
  };
}

function parseElement(
  context: ParseContext,
  ancestors: ElementASTNode[],
): ElementASTNode {
  const element = parseTag(context);
  if (element.isSelfClosing) return element;

  // 根据不同的标签切换不同的模式
  if (/title|textarea/i.test(element.tag)) {
    context.mode = TextModes.RCDATA;
  } else if (/style|xmp|iframe|noembed|noframes|noscript/i.test(element.tag)) {
    context.mode = TextModes.RAWTEXT;
  } else {
    context.mode = TextModes.DATA;
  }

  ancestors.push(element);
  element.children = parseChildren(context, ancestors);
  ancestors.pop();

  if (context.source.startsWith(`</${element.tag}`)) {
    parseTag(context, "end");
  } else {
    console.error(`${element.tag}缺少闭合标签`);
  }

  return element;
}

function parseComment(context: ParseContext): CommentASTNode {
  context.advanceBy("<!--".length);
  const closeIndex = context.source.indexOf("-->");
  if (closeIndex === -1) {
    console.error("缺少注释结束符");
  }

  const content = context.source.slice(0, closeIndex);
  context.advanceBy(content.length);
  context.advanceBy("-->".length);

  return { type: "Comment", content };
}

function parseCDATA(context: ParseContext) {}

const namedCharacterReference = {
  lt: "<",
  "lt;": "<",
  "ltcc;": "⪦",
  // 省略若干...
};

const CCR_REPLACEMENT = {
  0x80: 0x20ac,
  0x82: 0x201a,
  // 省略若干...
};

function decodeHTML(rawText: string, asAttr = false) {
  let offset = 0;
  const end = rawText.length;
  let decodedText = "";
  /**
   * namedCharacterReference最长的字符引用长度
   */
  let maxCRNameLength = 0;

  /**
   * 消费指定数量字符
   * @param num
   */
  function advance(num: number) {
    offset += num;
    rawText = rawText.slice(num);
  }

  while (offset < end) {
    const head = /&(?:#x?)?/.exec(rawText);
    if (!head) {
      decodedText += rawText;
      advance(rawText.length);
      break;
    }

    // 消费&之前的字符
    const str = rawText.slice(0, head.index);
    decodedText += str;
    advance(str.length);

    if (head[0] === "&") {
      // 命名字符引用

      // 只有&的下一位是ASCII字母或数字，才是合法的命名字符引用
      if (/[a-z0-9]/i.test(rawText[1])) {
        let name = "";
        let value;

        if (!maxCRNameLength) {
          maxCRNameLength = Object.keys(namedCharacterReference).reduce(
            (acc, item) => {
              return item.length > acc ? item.length : acc;
            },
            0,
          );
        }

        for (let i = maxCRNameLength; i > 0; i--) {
          name = rawText.slice(1, i + 1);
          value = namedCharacterReference[name];

          if (value) {
            // 作为属性时，如果匹配的最后一个字符不是分号，并且下一个字符是=、字母或数字，作为普通文本被解析
            if (
              asAttr &&
              !name.endsWith(";") &&
              /[=a-zA-Z0-9]/.test(rawText[name.length + 1] || "")
            ) {
              decodedText += `&${name}`;
            } else {
              decodedText += value;
            }

            advance(1 + name.length);
            break;
          }
        }

        // 没匹配到
        if (!value) {
          decodedText += `&${name}`;
          advance(1 + name.length);
        }
      } else {
        // 不是合法的命名字符引用，消费&
        decodedText += "&";
        advance(1);
      }
    } else {
      // 数字字符引用

      const hex = head[0] === "&#x";
      const reg = hex ? /^&#x([0-9a-f]+);/i : /^&#([0-9]+);/;

      const match = reg.exec(rawText);
      if (match) {
        let codePoint = Number.parseInt(match[1], hex ? 16 : 10);

        // 对码点进行合法性校验
        if (codePoint === 0) {
          codePoint = 0xfffd;
        } else if (codePoint > 0x10ffff) {
          codePoint = 0xfffd;
        } else if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
          codePoint = 0xfffd;
        } else if (
          (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
          (codePoint & 0xfffe) === 0xfffe
        ) {
          // nocharacter 什么都不用做
        } else if (
          (codePoint >= 0x01 && codePoint <= 0x08) ||
          codePoint === 0x0b ||
          (codePoint >= 0x0d && codePoint <= 0x1f) ||
          (codePoint >= 0x7f && codePoint <= 0x9f)
        ) {
          codePoint = CCR_REPLACEMENT[codePoint] || codePoint;
        }

        const value = String.fromCodePoint(codePoint);

        decodedText += value;
        advance(match[0].length);
      } else {
        decodedText += head[0];
        advance(head[0].length);
      }
    }
  }

  return decodedText;
}

function parseText(context: ParseContext): TextASTNode {
  let endIndex = context.source.length;
  const ltIndex = context.source.indexOf("<");
  const delimiterIndex = context.source.indexOf("{{");

  if (ltIndex > -1) {
    endIndex = ltIndex;
  }

  if (delimiterIndex > -1 && delimiterIndex < endIndex) {
    endIndex = delimiterIndex;
  }

  const content = context.source.slice(0, endIndex);
  context.advanceBy(content.length);

  return {
    type: "Text",
    content: decodeHTML(content, true),
  };
}

function parseInterpolation(context: ParseContext): InterpolationASTNode {
  context.advanceBy("{{".length);
  const closeIndex = context.source.indexOf("}}");
  let content;

  if (closeIndex > -1) {
    content = context.source.slice(0, closeIndex);
    context.advanceBy(content.length);
    context.advanceBy("}}".length);
  } else {
    console.error("插值缺少结束定界符");
    content = context.source;
    context.advanceBy(content.length);
  }

  return { type: "Interpolation", content: { type: "Expression", content } };
}

function parseChildren(
  context: ParseContext,
  ancestors: ElementASTNode[],
): TemplateASTNode[] {
  const nodes: TemplateASTNode[] = [];

  while (!isEnd(context, ancestors)) {
    let node;

    if (context.mode === TextModes.DATA || context.mode === TextModes.RCDATA) {
      if (context.mode === TextModes.DATA && context.source[0] === "<") {
        if (/[a-z]/i.test(context.source[1])) {
          node = parseElement(context, ancestors);
        } else if (context.source.startsWith("<!--")) {
          node = parseComment(context);
        } else if (context.source.startsWith("<![CDATA[")) {
          node = parseCDATA(context);
        }
      } else if (context.source.startsWith("{{")) {
        node = parseInterpolation(context);
      }
    }

    // 非DATA且非RCDATA，作为文本处理
    if (!node) {
      node = parseText(context);
    }

    nodes.push(node);
  }

  return nodes;
}

/**
 * 接收vue模板，返回模板AST
 * @param str
 */
export function parse(str: string): RootASTNode {
  const context: ParseContext = {
    source: str,
    mode: TextModes.DATA,
    advanceBy(num) {
      context.source = context.source.slice(num);
    },
    advanceSpaces() {
      const match = /^[\r\n\t\f ]+/.exec(context.source);
      if (match) {
        context.advanceBy(match[0].length);
      }
    },
  };

  const nodes = parseChildren(context, []);

  return {
    type: "Root",
    children: nodes,
  };
}
