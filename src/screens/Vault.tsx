import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { ItemKind, ItemMeta } from "../lib/types";
import ItemList from "../components/ItemList";
import SearchBar from "../components/SearchBar";
import ItemEditor from "./ItemEditor";
import Generator from "../components/Generator";
import { PlusIcon } from "../components/Icon";
import { useHotkey } from "../lib/useHotkey";

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
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const kind = filter === "all" ? undefined : filter;

  async function refresh() {
    const list = await api.listItems(query || undefined, kind);
    setItems(list);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, refreshKey]);

  useHotkey("ctrl+k", () => {
    document.getElementById("vault-search")?.focus();
  });
  useHotkey("escape", () => setAddMenuOpen(false), addMenuOpen);

  useEffect(() => {
    if (!addMenuOpen) return;
    function onOutside(e: MouseEvent) {
      if (!addMenuRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [addMenuOpen]);

  async function handleDelete(id: string) {
    await api.deleteItem(id);
    refresh();
  }

  const addKinds: { kind: ItemKind; label: string }[] = [
    { kind: "login", label: "Login" },
    { kind: "note", label: "Note" },
    { kind: "card", label: "Card" },
  ];

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-8 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-headline-md text-on-surface">Vault items</h1>
        <span className="label-md rounded-chip bg-surface-container-high px-2 py-1">
          {items.length} total
        </span>
      </div>

      <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface-container-lowest py-1">
        <SearchBar value={query} onChange={setQuery} />
        <button type="button" className="btn-secondary" onClick={() => setShowGenerator(true)}>
          Generate
        </button>
        <div className="relative" ref={addMenuRef}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setAddMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
          >
            <PlusIcon size={14} /> Add
          </button>
          {addMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 flex w-36 flex-col overflow-hidden rounded-control border border-white/8 bg-surface shadow-lg"
            >
              {addKinds.map(({ kind: k, label }) => (
                <button
                  key={k}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onEditNew(k);
                  }}
                  className="px-3 py-2 text-left text-body-sm text-on-surface transition-colors duration-150 ease-out hover:bg-white/4"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5">
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
