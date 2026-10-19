/**
 * Code-block syntax highlighting, matching Inkdrop's preview `Highlighter`
 * component (bundle `Gw`/`ore`).
 *
 * Inkdrop parses the block with a CodeMirror Lezer parser resolved from
 * `@codemirror/language-data` (plus user-registered languages) and walks the
 * tree with `highlightTree` using the `@inkdropapp/cm6-theme-common` token
 * HighlightStyle. That style emits `tok-*` classes, which
 * `src/renderer/markdown/inkdrop.css` colours with the `--syntax-*` tokens.
 */
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightTree } from "@lezer/highlight";
import { inkdropHighlightStyle } from "./highlight-style";
import { escapeHtml } from "./escape";

type Parser = LanguageSupport["language"]["parser"];

const parserCache = new Map<string, Promise<Parser | null>>();

async function loadParser(lang: string): Promise<Parser | null> {
  const description = LanguageDescription.matchLanguageName(languages, lang, true);
  if (!description) return null;
  try {
    const support = description.support ?? (await description.load());
    return support.language.parser;
  } catch {
    return null;
  }
}

function getParser(lang: string): Promise<Parser | null> {
  const key = lang.toLowerCase();
  let cached = parserCache.get(key);
  if (!cached) {
    cached = loadParser(lang);
    parserCache.set(key, cached);
  }
  return cached;
}

/**
 * Highlight `code` as `lang`, returning HTML where every text segment is
 * wrapped in a `<span class="…">` exactly like Inkdrop's `Zne`/`Gw`
 * highlighter (untokenised text gets an empty class). Unknown languages fall
 * back to a single plain span.
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
  const parser = await getParser(lang);
  if (!parser) return span("", code);

  let tree;
  try {
    tree = parser.parse(code);
  } catch {
    return span("", code);
  }

  let html = "";
  let position = 0;
  highlightTree(tree, inkdropHighlightStyle, (from, to, tokenClasses) => {
    if (from > position) html += span("", code.slice(position, from));
    html += span(tokenClasses, code.slice(from, to));
    position = to;
  });
  if (position < code.length) html += span("", code.slice(position));

  return html;
}

function span(className: string, text: string): string {
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}
