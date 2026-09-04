import type { ItemMeta } from "../lib/types";
import { TrashIcon } from "./Icon";

interface Props {
  items: ItemMeta[];
  onSelect: (item: ItemMeta) => void;
  onDelete: (id: string) => void;
}

function formatStamp(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ItemList({ items, onSelect, onDelete }: Props) {
  if (items.length === 0) {
    return <p className="empty">No items yet · add your first one</p>;
  }
  return (
    <ul className="item-list">
      {items.map((it) => (
        <li key={it.id}>
          <button
            className="row"
            onClick={() => onSelect(it)}
            aria-label={`Edit ${it.title}`}
          >
            <span className={`kind kind-${it.kind}`}>{it.kind}</span>
            <span className="title">{it.title}</span>
            <span className="meta">{formatStamp(it.updated_at)}</span>
          </button>
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
