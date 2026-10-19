/**
 * Inkdrop 6.2.0 markdown pipeline.
 *
 * Reconstructed from the shipped renderer bundle (`markdownRenderer` in
 * `app--8nT0s9w.js`). The plugin order, options and custom handlers below are
 * a faithful port of Inkdrop's `MDERenderer`, so the preview DOM matches the
 * real app:
 *
 *   remarkParse → remarkGfm → remarkMath → inkdrop protocol (micromark +
 *   transform) → frontmatter(yaml) → gfm alerts → fenced marker → code meta →
 *   image size → [user plugins, e.g. gemoji] → remarkRehype({allowDangerousHtml,
 *   handlers:{listItem, code}}) → rehypeRaw → line-start/line-end → rehypeSlug
 *
 * The hast is then passed through `renderCodeBlocks` (the React component tree
 * `code`/`pre` renders) and stringified.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkGemoji from "remark-gemoji";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { renderCodeBlocks } from "./code";

/* ── shared helpers ──────────────────────────────────────────────────────── */

/**
 * `Xu` from the bundle: parse `key=value key2="quoted value" flag` meta
 * strings into a map.
 */
const META_RE =
  /((?<k1>[^=\s]+)=((?<v1>(["'`])(.*?)\5)|(?<v2>\S+)))|(?<k2>\S+)/g;

export function parseMeta(input: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const matches = (input ?? "").matchAll(META_RE);
  for (const match of matches) {
    const groups = match.groups ?? {};
    const unquoted = unquote(groups.v1);
    const value = unquoted ?? groups.v2;
    const key = groups.k1 ?? groups.k2;
    if (key && value !== undefined) out[key] = value;
  }
  return out;
}

/** `Zu` from the bundle: serialise a meta object back to a string. */
export function formatMeta(meta: Record<string, string | undefined>): string {
  return Object.entries(meta)
    .map(([key, value]) => [key, value].filter((v) => v !== undefined))
    .map((pair) => pair.join("="))
    .join(" ");
}

function unquote(value: string | undefined): string | undefined {
  if (value === undefined || value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'" || first === "`") && first === last) {
    return value.slice(1, -1);
  }
  return value;
}

/* ── mdast plugins ───────────────────────────────────────────────────────── */

/** Inkdrop's `inkdrop://` autolink transform (`jd` in the bundle). */
function inkdropProtocol(): (tree: any) => void {
  return (tree: any) => {
    visit(tree, "text", (node: any, index, parent: any) => {
      if (!parent || typeof index !== "number") return;
      const value: string = node.value;
      const replace: any[] = [];
      const re = /(inkdrop:\/\/)([-._\w]+)([^ \t\r\n]*)/gi;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(value)) !== null) {
        // Only auto-link when the match starts a word.
        const before = value.charCodeAt(match.index - 1);
        const atStart =
          match.index === 0 || isWhitespaceOrBreak(before);
        if (!atStart) continue;
        if (match.index > lastIndex) {
          replace.push({ type: "text", value: value.slice(lastIndex, match.index) });
        }
        const url = match[0];
        replace.push({
          type: "link",
          title: null,
          url,
          children: [{ type: "text", value: url }],
        });
        lastIndex = match.index + match[0].length;
      }
      if (replace.length === 0) return;
      if (lastIndex < value.length) {
        replace.push({ type: "text", value: value.slice(lastIndex) });
      }
      parent.children.splice(index, 1, ...replace);
      return index + replace.length;
    });
  };
}

function isWhitespaceOrBreak(code: number): boolean {
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 13 ||
    code === 12
  );
}

/* ── GFM alerts (`Bd` in the bundle) ─────────────────────────────────────── */

interface AlertType {
  svgIcon: string;
  title: string;
  cssClass: string;
}

const ALERT_TYPES: Record<string, AlertType> = {
  "[!NOTE]": {
    svgIcon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>`,
    title: "Note",
    cssClass: "gfm-alert-type-note",
  },
  "[!TIP]": {
    svgIcon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>`,
    title: "Tip",
    cssClass: "gfm-alert-type-tip",
  },
  "[!IMPORTANT]": {
    svgIcon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>`,
    title: "Important",
    cssClass: "gfm-alert-type-important",
  },
  "[!WARNING]": {
    svgIcon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>`,
    title: "Warning",
    cssClass: "gfm-alert-type-warning",
  },
  "[!CAUTION]": {
    svgIcon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>`,
    title: "Caution",
    cssClass: "gfm-alert-type-caution",
  },
};

function gfmAlerts(): (tree: any) => void {
  return (tree: any) => {
    visit(tree, "blockquote", (node: any) => {
      const blockquote = node;
      const first = blockquote.children?.[0];
      if (!first || first.type !== "paragraph") return;
      const paragraph = first;
      const head = paragraph.children?.[0];
      if (!head || head.type !== "text") return;

      let marker: string;
      let type: AlertType | undefined;
      const newline = head.value.indexOf("\n");

      if (newline < 0) {
        marker = head.value;
        type = ALERT_TYPES[marker];
        if (!type) return;
        if (paragraph.children.length > 1) {
          if (paragraph.children.at(1)?.type === "break") {
            paragraph.children.splice(1, 1);
          } else {
            return;
          }
        }
        paragraph.children.shift();
      } else {
        const rest = head.value.substring(newline + 1);
        marker = head.value.substring(0, newline);
        const trailing = /[ \t\v\f\r]+$/.exec(marker);
        if (trailing) marker = marker.substring(0, marker.length - trailing[0].length);
        type = ALERT_TYPES[marker];
        if (!type) return;
        head.value = rest;
      }

      const title = { value: type.title, type: "text" };
      const titleParagraph = {
        type: "paragraph",
        children: [
          { type: "html", value: `<span class='icon'>${type.svgIcon}</span>` },
          title,
        ],
        data: { hProperties: { className: "gfm-alert-title" } },
      };
      blockquote.children.unshift(titleParagraph);
      blockquote.data = {
        ...blockquote.data,
        hProperties: { className: `gfm-alert ${type.cssClass}` },
        hName: "div",
      };
    });
  };
}

/* ── fenced marker (`$d`) ────────────────────────────────────────────────── */

function fencedMarker(): (tree: any) => void {
  return (tree: any) => {
    visit(tree, "code", (node: any) => {
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, fenced: "1" },
      };
    });
  };
}

/* ── code meta (`tf`/`ef`) ───────────────────────────────────────────────── */

function codeMeta(): (tree: any) => void {
  return (tree: any) => {
    visit(tree, "code", (node: any) => {
      if (typeof node.lang !== "string") return;
      const [lang, title, line] = node.lang.split(":");
      node.lang = lang;
      const properties = { ...node.data?.hProperties };
      if (title || line) node.meta = formatMeta({ title, line });
      node.data = { ...node.data, hProperties: { ...properties, lang } };
    });
  };
}

/* ── image size (`lf`/`cf`) ──────────────────────────────────────────────── */

const IMAGE_SIZE_RE = String.raw`(?:(?:\d*\.)?\d+(?:%|ch|cm|em|ex|in|mm|pc|pt|px)?|auto)`;
const WIDTH_RE = new RegExp(`^w(?:idth)?:(${IMAGE_SIZE_RE})$`);
const HEIGHT_RE = new RegExp(`^h(?:eight)?:(${IMAGE_SIZE_RE})$`);
const NUMBER_RE = /^(\d*\.)?\d+$/;

function toCssSize(value: string): string {
  return NUMBER_RE.test(value) ? `${value}px` : value;
}

export function parseImageSize(alt: string): {
  width?: string;
  height?: string;
  alt: string;
} {
  const tokens = alt.split(/(\s+)/);
  let width: string | undefined;
  let height: string | undefined;
  let rest = "";
  for (let i = 0; i < tokens.length; i += 2) {
    const token = tokens[i];
    if (!token) continue;
    const separator = i > 0 ? tokens[i - 1] : "";
    const widthMatch = token.match(WIDTH_RE);
    const heightMatch = token.match(HEIGHT_RE);
    if (widthMatch) width = toCssSize(widthMatch[1]);
    else if (heightMatch) height = toCssSize(heightMatch[1]);
    else rest += separator + token;
  }
  return {
    ...(width !== undefined && { width }),
    ...(height !== undefined && { height }),
    alt: rest.trimStart(),
  };
}

function imageSize(): (tree: any) => void {
  return (tree: any) => {
    visit(tree, ["image", "imageReference"], (node: any) => {
      const { width, height, alt } = parseImageSize(node.alt || "");
      if (!width && !height) return;
      const style = [width && `width:${width}`, height && `height:${height}`]
        .filter(Boolean)
        .join(";");
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, style, alt },
      };
    });
  };
}

/* ── remark-rehype handlers (`yp`) ───────────────────────────────────────── */

function listItemHandler(state: any, node: any, parent: any): any {
  const results = state.all(node);
  const loose = parent ? listLoose(parent) : listItemLoose(node);
  const properties: any = {};
  const children: any[] = [];

  if (typeof node.checked === "boolean") {
    const head = results[0];
    let paragraph: any;
    if (head && head.type === "element" && head.tagName === "p") {
      paragraph = head;
    } else {
      paragraph = { type: "element", tagName: "p", properties: {}, children: [] };
      results.unshift(paragraph);
    }
    if (paragraph.children.length > 0) {
      paragraph.children.unshift({ type: "text", value: " " });
    }
    paragraph.children.unshift({
      type: "element",
      tagName: "input",
      properties: {
        type: "checkbox",
        checked: node.checked,
        disabled: true,
        className: ["task-list-item-checkbox"],
      },
      children: [],
      position: node.position,
    });
    properties.className = ["task-list-item", ...(node.checked ? ["checked"] : [])];
  }

  let index = -1;
  while (++index < results.length) {
    const child = results[index];
    if (
      loose ||
      index !== 0 ||
      child.type !== "element" ||
      child.tagName !== "p"
    ) {
      children.push({ type: "text", value: "\n" });
    }
    if (child.type === "element" && child.tagName === "p" && !loose) {
      children.push(...child.children);
    } else {
      children.push(child);
    }
  }

  const tail = results[results.length - 1];
  if (tail && (loose || tail.type !== "element" || tail.tagName !== "p")) {
    children.push({ type: "text", value: "\n" });
  }

  const result = { type: "element", tagName: "li", properties, children };
  state.patch(node, result);
  return state.applyData(node, result);
}

function listLoose(node: any): boolean {
  let loose = false;
  if (node.type === "list") {
    loose = node.spread || false;
    const children = node.children;
    let index = -1;
    while (!loose && ++index < children.length) {
      loose = listItemLoose(children[index]);
    }
  }
  return loose;
}

function listItemLoose(node: any): boolean {
  const spread = node.spread;
  return spread === undefined || spread === null
    ? node.children.length > 1
    : spread;
}

function codeHandler(state: any, node: any): any {
  const value = node.value ? node.value + "\n" : "";
  const properties: any = {};
  if (node.lang) properties.className = ["language-" + node.lang];
  let result: any = {
    type: "element",
    tagName: "code",
    properties,
    children: [{ type: "text", value }],
  };
  state.patch(node, result);
  result = state.applyData(node, result);

  const pre: any = {
    type: "element",
    tagName: "pre",
    properties: { lang: node.lang ?? undefined },
    children: [result],
  };
  if (node.meta) {
    properties.meta = node.meta;
    pre.properties.meta = node.meta;
  }
  const div = {
    type: "element",
    tagName: "div",
    properties: {
      className: ["codeblock", ...(node.lang ? ["lang-" + node.lang] : [])],
    },
    children: [pre],
  };
  state.patch(node, div);
  return div;
}

/* ── rehype plugins ──────────────────────────────────────────────────────── */

/** `eee`/`bp`: attach source line numbers to every element. */
function lineNumbers(): (tree: any) => void {
  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      const start =
        node.position && node.position.start ? node.position.start.line : -1;
      const end = node.position && node.position.end ? node.position.end.line : -1;
      if (start < 0 || end < 0) return;
      node.properties = {
        ...node.properties,
        "line-start": start,
        "line-end": end,
      };
    });
  };
}

/* ── processor ───────────────────────────────────────────────────────────── */

let processorCache: any = null;

function getProcessor(): any {
  if (processorCache) return processorCache;
  processorCache = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(inkdropProtocol)
    .use(remarkFrontmatter, ["yaml"])
    .use(gfmAlerts)
    .use(fencedMarker)
    .use(codeMeta)
    .use(imageSize)
    .use(remarkGemoji)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: { listItem: listItemHandler, code: codeHandler },
    })
    .use(rehypeRaw)
    .use(lineNumbers)
    .use(rehypeSlug)
    .use(rehypeStringify, { allowDangerousHtml: true });
  return processorCache;
}

export interface MarkdownRenderResult {
  html: string;
  isKatexRequired: boolean;
}

/** Walk the hast looking for `language-math` code, like `Pd` in the bundle. */
function containsMath(tree: any): boolean {
  let found = false;
  visit(tree, "element", (node: any) => {
    if (found) return false;
    if (node.tagName !== "code") return;
    const classes = Array.isArray(node.properties?.className)
      ? node.properties.className
      : [];
    if (classes.includes("language-math")) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

export async function renderMarkdown(
  source: string
): Promise<MarkdownRenderResult> {
  const processor = getProcessor();
  const mdast = processor.parse(source);
  const hast: any = await processor.run(mdast);
  const isKatexRequired = containsMath(hast);
  await renderCodeBlocks(hast);
  const html = processor.stringify(hast);
  return { html: String(html), isKatexRequired };
}
