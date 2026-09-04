import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ItemKind, ItemMeta } from "../lib/types";
import ItemList from "../components/ItemList";
import SearchBar from "../components/SearchBar";
import ItemEditor from "./ItemEditor";
import Generator from "../components/Generator";

export default function Vault() {
  const [items, setItems] = useState<ItemMeta[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ItemKind | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);

  async function refresh() {
    const list = await api.listItems(query || undefined, kind ?? undefined);
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

  if (editing) {
    return (
      <ItemEditor
        id={editing === "new" ? null : editing}
        onClose={() => {
          setEditing(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="vault">
      <div className="toolbar">
        <SearchBar value={query} onChange={setQuery} />
        <div className="filters">
          <button
            className={kind === null ? "active" : ""}
            onClick={() => setKind(null)}
          >
            All
          </button>
          {(["login", "note", "card"] as ItemKind[]).map((k) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <button onClick={() => setShowGenerator(true)}>Generate</button>
        <button onClick={() => setEditing("new")}>+ Add</button>
      </div>
      <ItemList items={items} onSelect={(it) => setEditing(it.id)} onDelete={handleDelete} />
      {showGenerator && <Generator onClose={() => setShowGenerator(false)} />}
    </div>
  );
}
