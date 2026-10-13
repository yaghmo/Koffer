import { useRef, useState } from "react";
import { toggleLinePrefix, toggleWrap, type Selection } from "../lib/markdown";
import Markdown from "./Markdown";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rows?: number;
}

type Action =
  | { kind: "wrap"; token: string }
  | { kind: "prefix"; prefix: string };

const TOOLS: { label: string; title: string; action: Action; className?: string }[] = [
  { label: "B", title: "Bold  **text**", action: { kind: "wrap", token: "**" }, className: "font-semibold" },
  { label: "I", title: "Italic  *text*", action: { kind: "wrap", token: "*" }, className: "italic" },
  { label: "S", title: "Strikethrough  ~~text~~", action: { kind: "wrap", token: "~~" }, className: "line-through" },
  { label: "</>", title: "Code  `text`", action: { kind: "wrap", token: "`" }, className: "font-mono" },
  { label: "H", title: "Heading  ## text", action: { kind: "prefix", prefix: "## " }, className: "font-semibold" },
  { label: "•", title: "Bulleted list", action: { kind: "prefix", prefix: "- " } },
  { label: "1.", title: "Numbered list", action: { kind: "prefix", prefix: "1. " } },
  { label: "❝", title: "Quote", action: { kind: "prefix", prefix: "> " } },
];

/**
 * Plain-text note body with a formatting toolbar and a preview.
 *
 * The stored value stays Markdown text — no rich-text document model, so the
 * vault keeps holding exactly what the user typed and search still works on
 * it. The toolbar only rewrites the selection.
 */
export default function NoteEditor({ value, onChange, label, rows = 10 }: Props) {
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(action: Action) {
    const el = ref.current;
    if (!el) return;
    const sel: Selection = { value, start: el.selectionStart, end: el.selectionEnd };
    const next = action.kind === "wrap" ? toggleWrap(sel, action.token) : toggleLinePrefix(sel, action.prefix);
    onChange(next.value);
    // Restore the selection after React has written the new value back.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
          {TOOLS.map((tool) => (
            <button
              key={tool.label}
              type="button"
              title={tool.title}
              aria-label={tool.title}
              disabled={preview}
              onClick={() => apply(tool.action)}
              className={`min-w-[30px] rounded-control px-2 py-1 text-body-sm text-on-surface-variant transition-colors duration-150 ease-out hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40 ${tool.className ?? ""}`}
            >
              {tool.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          aria-pressed={preview}
          className="ml-auto rounded-control px-2 py-1 text-body-sm font-medium text-primary transition-colors duration-150 ease-out hover:bg-surface-container-high"
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div className="field h-auto min-h-[120px] overflow-y-auto py-2.5">
          <Markdown source={value} />
        </div>
      ) : (
        <textarea
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          spellCheck
          className="field h-auto resize-y py-2.5"
        />
      )}
      <p className="label-sm">
        Markdown: **bold**, *italic*, `code`, ## heading, - list, 1. list, &gt; quote
      </p>
    </div>
  );
}
