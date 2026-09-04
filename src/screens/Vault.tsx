import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ItemKind, ItemMeta } from "../lib/types";
import { PlusIcon } from "../components/Icon";
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
      <div>
        <p className="screen-eyebrow">Vault · Unlocked</p>
        <h1 className="screen-title">
          {items.length === 0
            ? "An empty room"
            : `${items.length} item${items.length === 1 ? "" : "s"} on the shelf`}
        </h1>
      </div>

      <div className="toolbar">
        <SearchBar value={query} onChange={setQuery} />
        <div className="toolbar-row">
          <div className="filters" aria-label="Filter by kind">
            <button
              type="button"
              className={kind === null ? "active" : ""}
              onClick={() => setKind(null)}
            >
              All
            </button>
            {(["login", "note", "card"] as ItemKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? "active" : ""}
                onClick={() => setKind(k)}
              >
                {k}
              </button>
            ))}
          </div>
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
            onClick={() => setEditing("new")}
          >
            <PlusIcon /> Add
          </button>
        </div>
      </div>

      <ItemList items={items} onSelect={(it) => setEditing(it.id)} onDelete={handleDelete} />

      {showGenerator && <Generator onClose={() => setShowGenerator(false)} />}
    </div>
  );
}
