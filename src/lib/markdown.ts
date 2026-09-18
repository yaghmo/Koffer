/**
 * A small Markdown subset for note bodies.
 *
 * Notes are stored as plain text — the vault stays greppable and nothing has
 * to be migrated — and this turns that text into a block list the renderer
 * walks. It deliberately produces data, not HTML: the renderer builds React
 * elements, so there is no `innerHTML` anywhere and no escaping to get wrong.
 */

export type InlineKind = "text" | "bold" | "italic" | "code" | "strike";

export interface Inline {
  kind: InlineKind;
  text: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "rule" };

const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence, or end of input
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) {
        items.push(BULLET.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ type: "bullets", items });
      continue;
    }

    if (ORDERED.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ORDERED.test(lines[i])) {
        items.push(ORDERED.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ type: "ordered", items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ type: "quote", text: quoted.join("\n") });
      continue;
    }

    // Plain text runs until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !FENCE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }

  return blocks;
}

// Order matters: ** before * so bold is not read as two italics.
const INLINE = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    const token = match[0];
    if (token.startsWith("**")) out.push({ kind: "bold", text: token.slice(2, -2) });
    else if (token.startsWith("~~")) out.push({ kind: "strike", text: token.slice(2, -2) });
    else if (token.startsWith("`")) out.push({ kind: "code", text: token.slice(1, -1) });
    else out.push({ kind: "italic", text: token.slice(1, -1) });
    last = at + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** True when the text uses any formatting the renderer would act on. */
export function hasFormatting(source: string): boolean {
  const blocks = parseBlocks(source);
  return blocks.some((b) => b.type !== "paragraph") || INLINE.test(source);
}

export interface Selection {
  value: string;
  start: number;
  end: number;
}

/**
 * Wrap the selection in `token` — or unwrap it when it is already wrapped, so
 * the toolbar button toggles like every other editor's does.
 */
export function toggleWrap(sel: Selection, token: string): Selection {
  const { value, start, end } = sel;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  if (selected.startsWith(token) && selected.endsWith(token) && selected.length >= token.length * 2) {
    const inner = selected.slice(token.length, selected.length - token.length);
    return { value: before + inner + after, start, end: start + inner.length };
  }
  if (before.endsWith(token) && after.startsWith(token)) {
    return {
      value: before.slice(0, -token.length) + selected + after.slice(token.length),
      start: start - token.length,
      end: end - token.length,
    };
  }
  const wrapped = token + (selected || "text") + token;
  return {
    value: before + wrapped + after,
    start: start + token.length,
    end: start + token.length + (selected || "text").length,
  };
}

/**
 * Prefix every line the selection touches — bullets, numbers, quotes,
 * headings. Applying the same prefix twice removes it.
 */
export function toggleLinePrefix(sel: Selection, prefix: string): Selection {
  const { value, start, end } = sel;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  const lines = value.slice(lineStart, lineEnd).split("\n");
  const numbered = /^\d+[.)]\s+/;
  const isNumberPrefix = numbered.test(prefix);
  const allPrefixed = lines.every((l) =>
    isNumberPrefix ? numbered.test(l) : l.startsWith(prefix),
  );

  const next = lines.map((line, n) => {
    if (allPrefixed) {
      return isNumberPrefix ? line.replace(numbered, "") : line.slice(prefix.length);
    }
    // Numbered lists renumber from 1 down the selection.
    return (isNumberPrefix ? `${n + 1}. ` : prefix) + line;
  });

  const replaced = next.join("\n");
  return {
    value: value.slice(0, lineStart) + replaced + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + replaced.length,
  };
}
