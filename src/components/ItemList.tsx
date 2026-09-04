import type { ItemMeta } from "../lib/types";

interface Props {
  items: ItemMeta[];
  onSelect: (item: ItemMeta) => void;
  onDelete: (id: string) => void;
}

export default function ItemList({ items, onSelect, onDelete }: Props) {
  if (items.length === 0) {
    return <p className="muted">No items yet. Add your first one.</p>;
  }
  return (
    <ul className="item-list">
      {items.map((it) => (
        <li key={it.id}>
          <button className="item" onClick={() => onSelect(it)}>
            <span className={`kind-badge kind-${it.kind}`}>{it.kind}</span>
            <span className="title">{it.title}</span>
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete "${it.title}"?`)) onDelete(it.id);
            }}
            aria-label={`Delete ${it.title}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
