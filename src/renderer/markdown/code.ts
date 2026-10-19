/**
 * Renders code blocks the way Inkdrop's React preview does.
 *
 * In the shipped app `remark-rehype` builds `div.codeblock > pre > code` and
 * then the React components `pre` (`dp`) / default `code` (`yd`) / math /
 * mermaid rewrite the tree. We run the same rewrite on the hast and inline the
 * resulting HTML so it can be injected with `dangerouslySetInnerHTML`.
 *
 * Resulting DOM for a fenced block:
 *
 *   <div class="codeblock lang-js">
 *     [<div class="codeblock-meta">…icon, title, filename, line info…</div>]
 *     <pre class="codeblock-has-meta" lang="js" meta="…">
 *       <button class="ui copy-to-clipboard button">…</button>
 *       <div class="mde-preview-code [with-line-numbers]">
 *         [<code class="mde-preview-code-line-number"><div class="tok-number">1</div>…</code>]
 *         <code class="mde-preview-code-body"><span style="display:contents">…tok spans…</span></code>
 *       </div>
 *     </pre>
 *   </div>
 */
import katex from "katex";
import { highlightCode } from "./highlight";
import { parseMeta } from "./pipeline";
import { escapeHtml } from "./escape";

export { escapeHtml };

const COLOR_HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOR_HSL_RE = /^hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/i;
const COLOR_RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)\s*\)$/i;
const GITHUB_PREFIX = "https://github.com/";

function classes(node: any): string[] {
  const value = node?.properties?.className;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

function textContent(node: any): string {
  if (node.type === "text") return node.value;
  if (Array.isArray(node.children)) return node.children.map(textContent).join("");
  return "";
}

/* ── icons ───────────────────────────────────────────────────────────────── */

const COPY_ICON = `<svg name="copy" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg name="check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const GITHUB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16"><path d="M12 0.28a12 12 0 0 0 -3.72 23.41l0.28 0a1 1 0 0 0 0.7 -0.24 1.05 1.05 0 0 0 0.36 -0.82v-0.21l0 -1.09a0.49 0.49 0 0 0 -0.19 -0.33 0.5 0.5 0 0 0 -0.41 -0.1c-2.69 0.58 -3.26 -1.1 -3.29 -1.21A4.64 4.64 0 0 0 4 17.5l-0.15 -0.11a0.73 0.73 0 0 1 0.38 -0.07 1.48 1.48 0 0 1 1.14 0.88 3 3 0 0 0 4 1.16 0.53 0.53 0 0 0 0.3 -0.36 2 2 0 0 1 0.56 -1.22 0.5 0.5 0 0 0 0.15 -0.53 0.49 0.49 0 0 0 -0.42 -0.35c-2.37 -0.27 -4.8 -1.1 -4.8 -5.19a4 4 0 0 1 1.06 -2.78 0.49 0.49 0 0 0 0.09 -0.52A3.56 3.56 0 0 1 6.32 6a5.57 5.57 0 0 1 2.52 1.15 0.48 0.48 0 0 0 0.42 0.06A10.66 10.66 0 0 1 12 6.85a10.31 10.31 0 0 1 2.75 0.36 0.46 0.46 0 0 0 0.41 -0.06A5.53 5.53 0 0 1 17.68 6a3.54 3.54 0 0 1 0 2.38 0.48 0.48 0 0 0 0.1 0.52 4 4 0 0 1 1.05 2.75c0 4.1 -2.43 4.92 -4.81 5.18a0.49 0.49 0 0 0 -0.42 0.35 0.49 0.49 0 0 0 0.15 0.52 2.23 2.23 0 0 1 0.61 1.75v3.18a1.06 1.06 0 0 0 0.37 0.82 1.18 1.18 0 0 0 1.06 0.19A12 12 0 0 0 12 0.28Z" fill="currentColor" stroke-width="1"/></svg>`;

const LANGUAGE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

/* ── code meta bar ───────────────────────────────────────────────────────── */

function parseLineStart(value: string | undefined): number | undefined {
  const head = (value || "").split("-")[0];
  const parsed = head ? parseInt(head, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metaBarHtml(meta: string, lang: string | undefined): string {
  const parsed = parseMeta(meta);
  const { title, filename, line, branch, commit, url } = parsed as Record<
    string,
    string | undefined
  >;

  const [start, end] = line ? line.split("-").map(Number) : [];
  const hasLine = !!line;
  const revision = branch || commit;

  let href = url?.replace(/#.*$/, "");
  const isGithub = !!href && href.startsWith(GITHUB_PREFIX);
  if (isGithub) href = href!.substring(GITHUB_PREFIX.length);

  const icon =
    isGithub || lang
      ? `<div class="codeblock-meta-icon">${
          isGithub ? GITHUB_ICON : LANGUAGE_ICON
        }</div>`
      : "";

  const filenameHtml = href
    ? `<a class="codeblock-filename codeblock-link" href="${escapeHtml(
        href
      )}" target="_blank">${escapeHtml(filename || href)}</a>`
    : filename
      ? `<span class="codeblock-filename">${escapeHtml(filename)}</span>`
      : "";

  const info: string[] = [];
  if (start && end) {
    info.push(`<span class="codeblock-line">Lines ${start}</span>`);
    info.push(`<span class="codeblock-line">to ${end}</span>`);
  } else if (hasLine) {
    info.push(`<span class="codeblock-line">Line at ${escapeHtml(line!)}</span>`);
  }
  if (revision) {
    info.push(
      `<span class="${branch ? "codeblock-branch" : "codeblock-commit-hash"}">in ${escapeHtml(
        revision
      )}</span>`
    );
  }

  const infoHtml =
    info.length > 0 ? `<div class="codeblock-info">${info.join("")}</div>` : "";

  return `<div class="codeblock-meta">${icon}<div class="codeblock-meta-body">${
    title ? `<div class="codeblock-title">${escapeHtml(title)}</div>` : ""
  }${filenameHtml}${infoHtml}</div></div>`;
}

/* ── copy button ─────────────────────────────────────────────────────────── */

function copyButtonHtml(code: string): string {
  return `<button type="button" class="ui copy-to-clipboard button" data-code="${escapeHtml(
    code
  )}">${COPY_ICON}${CHECK_ICON}</button>`;
}

/* ── default code block (`yd` + `Gw` highlighter) ────────────────────────── */

async function defaultCodeHtml(
  code: string,
  lang: string | undefined,
  meta: string | undefined
): Promise<string | null> {
  // Single-line unknown blocks that look like a CSS color render a swatch.
  if (
    !code.includes("\n") &&
    (COLOR_HEX_RE.test(code) ||
      COLOR_HSL_RE.test(code) ||
      COLOR_RGB_RE.test(code))
  ) {
    return `<code>${escapeHtml(
      code
    )} <span style="display:inline-block;background-color:${escapeHtml(
      code
    )};width:0.7em;height:0.7em;border:1px solid #888;border-radius:1em"></span></code>`;
  }

  const effectiveLang = lang ?? "unknown";
  const startLine = parseLineStart(parseMeta(meta).line);
  const lineCount = code.split("\n").length - 1;
  const lineNumbers =
    startLine !== undefined
      ? Array.from({ length: lineCount }, (_, i) => i + startLine)
      : null;

  const body = await highlightCode(code, effectiveLang);
  const wrapped = `<span style="display:contents">${body}</span>`;
  const gutter = lineNumbers
    ? `<code class="mde-preview-code-line-number">${lineNumbers
        .map((n) => `<div class="tok-number">${n}</div>`)
        .join("")}</code>`
    : "";

  return `<div class="mde-preview-code${
    lineNumbers ? " with-line-numbers" : ""
  }">${gutter}<code class="mde-preview-code-body">${wrapped}</code></div>`;
}

/* ── math (`@inkdropapp/math`) ───────────────────────────────────────────── */

function mathHtml(code: string, inline: boolean): string {
  try {
    const html = katex.renderToString(code, {
      displayMode: !inline,
      throwOnError: true,
    });
    const tag = inline ? "span" : "div";
    return `<${tag} class="inkdrop-math language-math ${
      inline ? "math-inline" : "math-display"
    }">${html}</${tag}>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<span class="ui error message mde-error-message">${escapeHtml(
      message
    )}</span>`;
  }
}

/* ── mermaid placeholder (rendered client-side by MarkdownTab) ───────────── */

/** Toolbar icons from `@inkdropapp/mermaid` (zoom in / reset / zoom out / expand). */
const MERMAID_ICONS = {
  zoomIn:
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M12 9H6M9 6V12M9 2C14.6 2 16 3.4 16 9C16 14.6 14.6 16 9 16C3.4 16 2 14.6 2 9C2 3.4 3.4 2 9 2Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  reset:
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M2.04663 9.77802C2.23746 11.484 3.04863 13.0603 4.32586 14.2072C5.60309 15.3541 7.25729 15.9915 8.97386 15.9983C10.6904 16.0051 12.3496 15.3808 13.6359 14.244C14.9222 13.1073 15.7458 11.5375 15.9502 9.8331C16.1545 8.12871 15.7253 6.40867 14.7442 5.0001C13.7631 3.59152 12.2985 2.59267 10.6289 2.1935C8.95942 1.79433 7.20141 2.02269 5.68927 2.83515C4.17713 3.64762 3.01634 4.9875 2.42765 6.59999" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M2 2.78046V6.66843H5.88796M8.22074 9.00044C8.22074 9.20667 8.30266 9.40445 8.44849 9.55028C8.59432 9.69611 8.7921 9.77803 8.99833 9.77803C9.20456 9.77803 9.40234 9.69611 9.54817 9.55028C9.694 9.40445 9.77592 9.20667 9.77592 9.00044C9.77592 8.79421 9.694 8.59642 9.54817 8.4506C9.40234 8.30477 9.20456 8.22284 8.99833 8.22284C8.7921 8.22284 8.59432 8.30477 8.44849 8.4506C8.30266 8.59642 8.22074 8.79421 8.22074 9.00044Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  zoomOut:
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M6.66667 9H11.3333M9 2C14.6 2 16 3.4 16 9C16 14.6 14.6 16 9 16C3.4 16 2 14.6 2 9C2 3.4 3.4 2 9 2Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  expand:
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 14 14" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="m1 13 4 -4"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M13 1 9 5"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="m1 1 4 4"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M13 13 9 9"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M13 5.00004c0.5 -1.50004 0.5 -2.50004 0 -4 -1.5 -0.500045 -2.5 -0.500059 -4 0"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M1.00003 9c-0.500033 1.5 -0.500042 2.5 -0.00001 4 1.49998 0.5 2.49998 0.5 4 0"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M1.00001 5.00004C0.5 3.5 0.5 2.5 1 1.00004c1.5 -0.500045 2.5 -0.500059 4 0"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" d="M13 9c0.5 1.5 0.5 2.5 0 4 -1.5 0.5 -2.5 0.5 -4.00002 0"/></svg>`,
};

function mermaidToolbarButton(action: string, label: string, icon: string): string {
  return `<button type="button" aria-label="${label}" data-mermaid-action="${action}">${icon}</button>`;
}

function mermaidHtml(code: string): string {
  return (
    `<div class="mermaid-diagram">` +
    `<div class="mermaid-diagram-content">` +
    `<div class="mermaid-dot-grid" data-mermaid-src="${escapeHtml(
      encodeURIComponent(code)
    )}"></div>` +
    `</div>` +
    `<div class="mermaid-toolbar"><div class="mermaid-toolbar-controls">` +
    mermaidToolbarButton("zoom-in", "Zoom in", MERMAID_ICONS.zoomIn) +
    mermaidToolbarButton("reset", "Reset zoom", MERMAID_ICONS.reset) +
    mermaidToolbarButton("zoom-out", "Zoom out", MERMAID_ICONS.zoomOut) +
    mermaidToolbarButton("expand", "Full screen", MERMAID_ICONS.expand) +
    `</div></div>` +
    `</div>`
  );
}

/* ── tree walk ───────────────────────────────────────────────────────────── */

async function renderPre(pre: any): Promise<void> {
  const codeEl = (pre.children || []).find(
    (child: any) => child.type === "element" && child.tagName === "code"
  );
  if (!codeEl) {
    // Inkdrop's `pre` component (`fp`) always renders the copy button, even
    // for raw `<pre>` markup with no `<code>` child.
    pre.children = [
      { type: "raw", value: copyButtonHtml(textContent(pre)) },
      ...(pre.children || []),
    ];
    return;
  }

  const codeClasses = classes(codeEl);
  const lang =
    typeof pre.properties?.lang === "string"
      ? pre.properties.lang
      : codeClasses
          .find((c) => c.startsWith("language-"))
          ?.split("-")[1];
  const meta =
    typeof pre.properties?.meta === "string" ? pre.properties.meta : undefined;
  const code = textContent(codeEl);

  let body: string | null;
  if (codeClasses.includes("language-math")) {
    body = mathHtml(code, codeClasses.includes("math-inline"));
  } else if (lang === "mermaid") {
    body = mermaidHtml(code);
  } else {
    body = await defaultCodeHtml(code, lang, meta);
  }

  if (body === null) return;

  const button = copyButtonHtml(code);
  pre.children = [{ type: "raw", value: button + body }];
}

async function walk(node: any): Promise<void> {
  if (!node || !Array.isArray(node.children)) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child?.type !== "element") continue;

    if (child.tagName === "div" && classes(child).includes("codeblock")) {
      const pre = child.children.find(
        (c: any) => c.type === "element" && c.tagName === "pre"
      );
      if (pre) {
        const meta =
          typeof pre.properties?.meta === "string" ? pre.properties.meta : undefined;
        if (meta) {
          const preClasses = classes(pre);
          pre.properties = {
            ...pre.properties,
            className: ["codeblock-has-meta", ...preClasses],
          };
          child.children.splice(child.children.indexOf(pre), 0, {
            type: "raw",
            value: metaBarHtml(meta, pre.properties?.lang),
          });
        }
        await renderPre(pre);
      }
      continue;
    }

    if (child.tagName === "pre") {
      await renderPre(child);
      continue;
    }

    if (child.tagName === "code") {
      const codeClasses = classes(child);
      if (codeClasses.includes("language-math")) {
        node.children[i] = {
          type: "raw",
          value: mathHtml(textContent(child), codeClasses.includes("math-inline")),
        };
        continue;
      }
      const text = textContent(child);
      if (
        !text.includes("\n") &&
        (COLOR_HEX_RE.test(text) ||
          COLOR_HSL_RE.test(text) ||
          COLOR_RGB_RE.test(text))
      ) {
        node.children[i] = {
          type: "raw",
          value: `<code>${escapeHtml(
            text
          )} <span style="display:inline-block;background-color:${escapeHtml(
            text
          )};width:0.7em;height:0.7em;border:1px solid #888;border-radius:1em"></span></code>`,
        };
        continue;
      }
      child.properties = { ...child.properties, className: ["language-unknown"] };
      continue;
    }

    await walk(child);
  }
}

export async function renderCodeBlocks(tree: any): Promise<void> {
  await walk(tree);
}
