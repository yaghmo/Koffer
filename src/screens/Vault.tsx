import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { onItemsChanged } from "../lib/events";
import { logUi } from "../lib/log";
import type { ItemKind, ItemMeta } from "../lib/types";
import ItemList, { PinnedTiles } from "../components/ItemList";
import SearchBar from "../components/SearchBar";
import ItemEditor from "./ItemEditor";
import { PlusIcon, SortIcon, ArrowRightIcon, PinIcon, KeyIcon, NoteIcon, CardIcon } from "../components/Icon";
import { useHotkey } from "../lib/useHotkey";
import { useOutsideClose } from "../lib/useOutsideClose";

type EditingTarget =
  | { kind: "existing"; id: string }
  | { kind: "new"; itemKind: ItemKind }
  | null;

type Filter = "all" | ItemKind;
type Sort = "az" | "za" | "recent";

const SORTS: { key: Sort; label: string }[] = [
  { key: "az", label: "Name A–Z" },
  { key: "za", label: "Name Z–A" },
  { key: "recent", label: "Recently updated" },
];

// How many rows each pane of the All-items dashboard shows before "+ more".
const LOGIN_PREVIEW = 10;
const SIDE_PREVIEW = 5;

interface Props {
  filter: Filter;
  editing: EditingTarget;
  viewingId: string | null;
  refreshKey?: number;
  onViewItem: (id: string) => void;
  onEditItem: (id: string) => void;
  onEditNew: (kind: ItemKind) => void;
  onEditorClose: () => void;
  onViewerClose: () => void;
  onItemSaved: () => void;
  onFilterChange?: (filter: Filter) => void;
}

/** Alphanumeric ordering, so "item 2" lands before "item 10". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Pinned items lead their pane; the rest keep the active sort order. */
function pinnedFirst(items: ItemMeta[]): ItemMeta[] {
  return [...items.filter((i) => i.pinned), ...items.filter((i) => !i.pinned)];
}

function sortItems(items: ItemMeta[], sort: Sort): ItemMeta[] {
  const out = [...items];
  if (sort === "recent") return out.sort((a, b) => b.updated_at - a.updated_at);
  out.sort((a, b) => collator.compare(a.title, b.title));
  return sort === "za" ? out.reverse() : out;
}

function SortMenu({ sort, onChange }: { sort: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  useHotkey("escape", () => setOpen(false), open);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SortIcon size={14} /> {SORTS.find((s) => s.key === sort)?.label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 flex w-48 flex-col overflow-hidden rounded-control border border-outline-variant bg-surface shadow-lg"
        >
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(s.key);
                setOpen(false);
                logUi("info", "vault", `sort=${s.key}`);
              }}
              className={`px-3 py-2 text-left text-body-sm transition-colors duration-150 ease-out hover:bg-surface-container-high ${
                s.key === sort ? "font-medium text-on-surface" : "text-on-surface-variant"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Pane({
  title,
  icon: Icon,
  count,
  onMore,
  children,
}: {
  title: string;
  icon: typeof KeyIcon;
  count: number;
  onMore: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="card flex min-w-0 flex-col gap-2 p-4">
      <header className="flex items-center gap-2">
        <Icon size={16} />
        <h2 className="flex-1 text-body-md font-semibold text-on-surface">{title}</h2>
      </header>
      {children}
      <button
        type="button"
        onClick={onMore}
        className="mt-auto flex items-center justify-center gap-2 rounded-control px-3 py-2 text-body-sm font-medium text-on-surface transition-colors duration-150 ease-out hover:bg-surface-container-high"
      >
        {count > 0 ? `All ${count} ${title.toLowerCase()}` : `Go to ${title.toLowerCase()}`}
        <ArrowRightIcon size={14} />
      </button>
    </section>
  );
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
  onFilterChange,
}: Props) {
  const [items, setItems] = useState<ItemMeta[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("az");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const kind = filter === "all" ? undefined : filter;

  async function refresh() {
    // The All-items dashboard needs every kind at once, so it always fetches
    // unfiltered and splits client-side.
    const list = await api.listItems(query || undefined, kind);
    setItems(list);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, refreshKey]);

  // The browser extension can add or change a login while this is open.
  useEffect(() => {
    const unlisten = onItemsChanged(() => refresh());
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind]);

  useHotkey("ctrl+k", () => {
    document.getElementById("vault-search")?.focus();
  });
  useHotkey("escape", () => setAddMenuOpen(false), addMenuOpen);
  useOutsideClose(addMenuRef, addMenuOpen, () => setAddMenuOpen(false));

  async function handleDelete(id: string) {
    await api.deleteItem(id);
    refresh();
  }

  async function togglePin(item: ItemMeta) {
    setPinError(null);
    try {
      await api.setItemPinned(item.id, !item.pinned);
      logUi("info", "vault", `${item.pinned ? "unpinned" : "pinned"} kind=${item.kind}`);
      await refresh();
    } catch (e: any) {
      setPinError(String(e));
    }
  }

  const sorted = sortItems(items, sort);
  const logins = sorted.filter((i) => i.kind === "login");
  const notes = sorted.filter((i) => i.kind === "note");
  const cards = sorted.filter((i) => i.kind === "card");
  const pinnedLogins = logins.filter((i) => i.pinned);

  const addKinds: { kind: ItemKind; label: string }[] = [
    { kind: "login", label: "Login" },
    { kind: "note", label: "Note" },
    { kind: "card", label: "Card" },
  ];

  const listProps = {
    onView: (it: ItemMeta) => onViewItem(it.id),
    onEdit: (it: ItemMeta) => onEditItem(it.id),
    onDelete: handleDelete,
    onOpen: (id: string) => api.openLoginItem(id).catch(() => {}),
    onTogglePin: togglePin,
  };

  // Searching collapses the dashboard into one flat result list — panes of
  // five would hide most of what was searched for.
  const searching = query.trim().length > 0;
  const dashboard = filter === "all" && !searching;

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-8 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-headline-md text-on-surface">
          {filter === "all" ? "All items" : `${filter[0].toUpperCase()}${filter.slice(1)}s`}
        </h1>
        <span className="label-md rounded-chip bg-surface-container-high px-2 py-1">{items.length} total</span>
      </div>

      <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface-container-lowest py-1">
        <SearchBar value={query} onChange={setQuery} />
        {!dashboard && <SortMenu sort={sort} onChange={setSort} />}
        <div className="relative" ref={addMenuRef}>
          {/* A kind filter already answers "add what?", so skip the menu. */}
          <button
            type="button"
            className="btn-primary"
            onClick={() => (kind ? onEditNew(kind) : setAddMenuOpen((o) => !o))}
            aria-haspopup={kind ? undefined : "menu"}
            aria-expanded={kind ? undefined : addMenuOpen}
          >
            <PlusIcon size={14} /> {kind ? `Add ${kind}` : "Add"}
          </button>
          {!kind && addMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 flex w-36 flex-col overflow-hidden rounded-control border border-outline-variant bg-surface shadow-lg"
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
                  className="px-3 py-2 text-left text-body-sm text-on-surface transition-colors duration-150 ease-out hover:bg-surface-container-high"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {pinError && (
        <p role="alert" className="text-body-sm text-error">
          {pinError}
        </p>
      )}

      {dashboard ? (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-on-surface">
              <PinIcon size={14} filled />
              <h2 className="text-body-md font-semibold">Pinned</h2>
              <span className="label-sm">{pinnedLogins.length}/10</span>
            </div>
            {pinnedLogins.length > 0 ? (
              <PinnedTiles items={pinnedLogins} onView={(it) => onViewItem(it.id)} onTogglePin={togglePin} />
            ) : (
              <p className="text-body-sm text-on-surface-variant">
                Pin a login from any list to keep it here — up to 10.
              </p>
            )}
          </section>

          <hr className="border-outline-variant" />

          {/* Half and half: logins run long on the left, notes over cards on
              the right, each capped so the screen stays one glance. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Pane
              title="Logins"
              icon={KeyIcon}
              count={logins.length}
              onMore={() => onFilterChange?.("login")}
            >
              <ItemList
                items={logins.slice(0, LOGIN_PREVIEW)}
                emptyLabel="No logins yet"
                compact
                {...listProps}
              />
            </Pane>
            <div className="flex min-w-0 flex-col gap-4">
              <Pane title="Notes" icon={NoteIcon} count={notes.length} onMore={() => onFilterChange?.("note")}>
                <ItemList
                  items={pinnedFirst(notes).slice(0, SIDE_PREVIEW)}
                  emptyLabel="No notes yet"
                  compact
                  {...listProps}
                />
              </Pane>
              <Pane title="Cards" icon={CardIcon} count={cards.length} onMore={() => onFilterChange?.("card")}>
                <ItemList
                  items={pinnedFirst(cards).slice(0, SIDE_PREVIEW)}
                  emptyLabel="No cards yet"
                  compact
                  {...listProps}
                />
              </Pane>
            </div>
          </div>
        </>
      ) : (
        <ItemList items={sorted} {...listProps} />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
          <ItemEditor
            id={editing.kind === "existing" ? editing.id : null}
            initialKind={editing.kind === "new" ? editing.itemKind : undefined}
            lockKind={editing.kind === "new" && kind !== undefined}
            onClose={onEditorClose}
            onSaved={onItemSaved}
          />
        </div>
      )}
    </div>
  );
}
