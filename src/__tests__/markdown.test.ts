import { describe, it, expect } from "vitest";
import { parseBlocks, parseInline, toggleWrap, toggleLinePrefix } from "../lib/markdown";

describe("parseBlocks", () => {
  it("reads headings, lists, quotes and rules", () => {
    const blocks = parseBlocks(
      ["## Server", "- one", "- two", "1. first", "2. second", "> careful", "---"].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "Server" },
      { type: "bullets", items: ["one", "two"] },
      { type: "ordered", items: ["first", "second"] },
      { type: "quote", text: "careful" },
      { type: "rule" },
    ]);
  });

  it("keeps a fenced code block verbatim", () => {
    const blocks = parseBlocks("```\nnot **bold** here\n  indented\n```");
    expect(blocks).toEqual([{ type: "code", text: "not **bold** here\n  indented" }]);
  });

  it("joins wrapped lines into one paragraph and splits on a blank line", () => {
    const blocks = parseBlocks("first line\nsame paragraph\n\nsecond");
    expect(blocks).toEqual([
      { type: "paragraph", text: "first line\nsame paragraph" },
      { type: "paragraph", text: "second" },
    ]);
  });

  it("returns nothing for empty or blank input", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("   \n\n ")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("splits bold, italic, code and strikethrough out of the text", () => {
    expect(parseInline("a **b** c `d` ~~e~~ *f*")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " c " },
      { kind: "code", text: "d" },
      { kind: "text", text: " " },
      { kind: "strike", text: "e" },
      { kind: "text", text: " " },
      { kind: "italic", text: "f" },
    ]);
  });

  it("does not read bold as two italics", () => {
    expect(parseInline("**x**")).toEqual([{ kind: "bold", text: "x" }]);
  });

  it("leaves plain text alone", () => {
    expect(parseInline("nothing here")).toEqual([{ kind: "text", text: "nothing here" }]);
  });
});

describe("toggleWrap", () => {
  it("wraps the selection and keeps it selected", () => {
    const out = toggleWrap({ value: "hello world", start: 6, end: 11 }, "**");
    expect(out.value).toBe("hello **world**");
    expect(out.value.slice(out.start, out.end)).toBe("world");
  });

  it("unwraps when the selection is already wrapped", () => {
    const out = toggleWrap({ value: "hello **world**", start: 6, end: 15 }, "**");
    expect(out.value).toBe("hello world");
  });

  it("unwraps when the markers sit just outside the selection", () => {
    const out = toggleWrap({ value: "hello **world**", start: 8, end: 13 }, "**");
    expect(out.value).toBe("hello world");
  });

  it("inserts a placeholder when nothing is selected", () => {
    const out = toggleWrap({ value: "", start: 0, end: 0 }, "*");
    expect(out.value).toBe("*text*");
    expect(out.value.slice(out.start, out.end)).toBe("text");
  });
});

describe("toggleLinePrefix", () => {
  it("prefixes every line the selection touches", () => {
    const out = toggleLinePrefix({ value: "one\ntwo", start: 0, end: 7 }, "- ");
    expect(out.value).toBe("- one\n- two");
  });

  it("removes the prefix when all lines already have it", () => {
    const out = toggleLinePrefix({ value: "- one\n- two", start: 0, end: 11 }, "- ");
    expect(out.value).toBe("one\ntwo");
  });

  it("renumbers an ordered list from one", () => {
    const out = toggleLinePrefix({ value: "a\nb\nc", start: 0, end: 5 }, "1. ");
    expect(out.value).toBe("1. a\n2. b\n3. c");
  });

  it("works from a caret inside a single line", () => {
    const out = toggleLinePrefix({ value: "first\nsecond", start: 8, end: 8 }, "> ");
    expect(out.value).toBe("first\n> second");
  });
});
