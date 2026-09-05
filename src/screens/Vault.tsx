import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ItemKind, ItemMeta } from "../lib/types";
import ItemList from "../components/ItemList";
import SearchBar from "../components/SearchBar";
import ItemEditor from "./ItemEditor";
import Generator from "../components/Generator";

type EditingTarget =
  | { kind: "existing"; id: string }
  | { kind: "new"; itemKind: ItemKind }
  | null;

interface Props {
  filter: "all" | "login" | "note" | "card";
  editing: EditingTarget;
  viewingId: string | null;
  refreshKey?: number;
  onViewItem: (id: string) => void;
  onEditItem: (id: string) => void;
  onEditNew: (kind: ItemKind) => void;
  onEditorClose: () => void;
  onViewerClose: () => void;
  onItemSaved: () => void;
}

export default function Vault({
  filter,
  editing,
  refreshKey,
  onViewItem,
  onEditItem,
  onEditNew,
  onEditorClose,
  onItemSaved,
}: Props) {
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
  }, [query, kind, refreshKey]);

  async function handleDelete(id: string) {
    await api.deleteItem(id);
    refresh();
  }

  // Three explicit "+ Kind" buttons so the user picks a kind up front instead
  // of opening an editor and switching tabs.
  const addKinds: ItemKind[] = ["login", "note", "card"];

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
          {addKinds.map((k) => (
            <button
              key={k}
              type="button"
              className="btn btn-primary"
              onClick={() => onEditNew(k)}
              aria-label={`Add ${k}`}
            >
              + {k}
            </button>
          ))}
        </div>
      </div>

      <ItemList
        items={items}
        onView={(it) => onViewItem(it.id)}
        onEdit={(it) => onEditItem(it.id)}
        onDelete={handleDelete}
        onOpen={(id) => api.openLoginItem(id).catch(() => {})}
      />

      {showGenerator && <Generator onClose={() => setShowGenerator(false)} />}

      {editing && (
        <div className="overlay">
          <ItemEditor
            id={editing.kind === "existing" ? editing.id : null}
            initialKind={editing.kind === "new" ? editing.itemKind : undefined}
            onClose={onEditorClose}
            onSaved={onItemSaved}
          />
        </div>
      )}
    </div>
  );
}
