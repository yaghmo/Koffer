import type { ItemMeta } from "../lib/types";
import { PencilIcon, TrashIcon, ExternalIcon } from "./Icon";
import { MethodChip } from "../lib/methods";

interface Props {
  items: ItemMeta[];
  onView: (item: ItemMeta) => void;
  onEdit?: (item: ItemMeta) => void;
  onDelete: (id: string) => void;
  onOpen?: (id: string) => void;
}

function formatStamp(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ItemList({ items, onView, onEdit, onDelete, onOpen }: Props) {
  if (items.length === 0) {
    return <p className="empty">No items yet · add your first one</p>;
  }
  return (
    <ul className="item-list">
      {items.map((it) => (
        <li key={it.id}>
          <button
            className="row"
            onClick={() => onView(it)}
            aria-label={`View ${it.title}`}
          >
            {it.favicon ? (
              <img className="favicon" src={it.favicon} alt="" />
            ) : it.kind === "login" && it.method ? (
              <MethodChip method={it.method} />
            ) : (
              <span className={`kind kind-${it.kind}`}>{it.kind}</span>
            )}
            <span className="title">{it.title}</span>
            {it.method && it.method !== "credentials" && (
              <span className="provider">{it.method}</span>
            )}
            <span className="meta">{formatStamp(it.updated_at)}</span>
          </button>
          {it.kind === "login" && onOpen && (
            <button
              className="edit open"
              onClick={() => onOpen(it.id)}
              aria-label={`Open ${it.title}`}
              title="Open in browser"
            >
              <ExternalIcon />
            </button>
          )}
          {onEdit && (
            <button
              className="edit"
              onClick={() => onEdit(it)}
              aria-label={`Edit ${it.title}`}
              title={`Edit ${it.title}`}
            >
              <PencilIcon />
            </button>
          )}
          <button
            className="delete"
            onClick={() => {
              if (confirm(`Delete "${it.title}"?`)) onDelete(it.id);
            }}
            aria-label={`Delete ${it.title}`}
            title={`Delete ${it.title}`}
          >
            <TrashIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}