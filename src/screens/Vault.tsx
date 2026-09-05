import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ItemMeta } from "../lib/types";
import { PlusIcon } from "../components/Icon";
import ItemList from "../components/ItemList";
import SearchBar from "../components/SearchBar";
import ItemEditor from "./ItemEditor";
import Generator from "../components/Generator";

interface Props {
  filter: "all" | "login" | "note" | "card";
  editingId: string | "new" | null;
  onEditItem: (id: string) => void;
  onEditNew: () => void;
  onEditorClose: () => void;
}

export default function Vault({ filter, editingId, onEditItem, onEditNew, onEditorClose }: Props) {
  const [items, setItems] = useState<ItemMeta[]>([]);
  const [query, setQuery] = useState("");
  const [showGenerator, setShowGenerator] = useState(false);

  const kind = filter === "all" ? undefined : filter;

  async function refresh() {
    const list = await api.listItems(query || undefined, kind);
    setItems(list);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind]);

  async function handleDelete(id: string) {
    await api.deleteItem(id);
    refresh();
  }

  return (
    <div className="vault">
      <div>
        <p className="screen-eyebrow">Vault</p>
        <h1 className="screen-title">
          {items.length === 0
            ? "An empty room"
            : `${items.length} item${items.length === 1 ? "" : "s"} on the shelf`}
        </h1>
      </div>

      <div className="toolbar">
        <SearchBar value={query} onChange={setQuery} />
        <div className="toolbar-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowGenerator(true)}
          >
            Generate
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onEditNew}
          >
            <PlusIcon /> Add
          </button>
        </div>
      </div>

      <ItemList items={items} onSelect={(it) => onEditItem(it.id)} onDelete={handleDelete} />

      {showGenerator && <Generator onClose={() => setShowGenerator(false)} />}

      {editingId && (
        <ItemEditor
          id={editingId === "new" ? null : editingId}
          onClose={onEditorClose}
        />
      )}
    </div>
  );
}
