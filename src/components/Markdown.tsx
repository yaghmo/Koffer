import { parseBlocks, parseInline } from "../lib/markdown";

/**
 * Renders a note body's formatting as React elements.
 *
 * Nothing here touches `innerHTML` — every piece of the note ends up as a
 * text child, so React escapes it and a note can never inject markup into
 * the app.
 */
function Line({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((piece, i) => {
        switch (piece.kind) {
          case "bold":
            return (
              <strong key={i} className="font-semibold text-on-surface">
                {piece.text}
              </strong>
            );
          case "italic":
            return (
              <em key={i} className="italic">
                {piece.text}
              </em>
            );
          case "strike":
            return (
              <s key={i} className="text-on-surface-variant">
                {piece.text}
              </s>
            );
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-body-sm text-tertiary"
              >
                {piece.text}
              </code>
            );
          default:
            return <span key={i}>{piece.text}</span>;
        }
      })}
    </>
  );
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-headline-sm text-on-surface",
  2: "text-body-lg font-semibold text-on-surface",
  3: "text-body-md font-semibold text-on-surface-variant",
};

export default function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  if (blocks.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">Empty.</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-body-md text-on-surface-variant">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading": {
            const Tag = (["h3", "h4", "h5"] as const)[block.level - 1];
            return (
              <Tag key={i} className={HEADING_CLASS[block.level]}>
                <Line text={block.text} />
              </Tag>
            );
          }
          case "bullets":
            return (
              <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
                {block.items.map((item, n) => (
                  <li key={n}>
                    <Line text={item} />
                  </li>
                ))}
              </ul>
            );
          case "ordered":
            return (
              <ol key={i} className="flex list-decimal flex-col gap-1 pl-5">
                {block.items.map((item, n) => (
                  <li key={n}>
                    <Line text={item} />
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-primary/40 pl-3 italic">
                <Line text={block.text} />
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-control border border-outline-variant p-3 font-mono text-body-sm text-on-surface"
              >
                {block.text}
              </pre>
            );
          case "rule":
            return <hr key={i} className="border-outline-variant" />;
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                <Line text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
