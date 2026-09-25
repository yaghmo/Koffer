import { useState } from "react";
import type { ItemMeta } from "../lib/types";
import {
  PencilIcon,
  TrashIcon,
  ExternalIcon,
  DatabaseIcon,
  NoteIcon,
  CardBrandIcon,
  PinIcon,
} from "./Icon";
import { MethodChip, providerForAccount } from "../lib/methods";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  items: ItemMeta[];
  onView: (item: ItemMeta) => void;
  onEdit?: (item: ItemMeta) => void;
  onDelete: (id: string) => void;
  onOpen?: (id: string) => void;
  onTogglePin?: (item: ItemMeta) => void;
  /** Rendered instead of the default "No items yet" placeholder. */
  emptyLabel?: string;
  compact?: boolean;
}

function formatStamp(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The provider chip a login should wear, or null when it has none. */
export function providerOf(it: ItemMeta) {
  if (it.kind !== "login") return null;
  if (it.method && it.method !== "credentials") return it.method;
  // A site login with a Gmail address is that site's login, not Google's:
  // the account's domain only says something when there is no site.
  return it.host ? null : providerForAccount(it.username ?? "");
}

// Item icon: site favicon wins, else provider chip — from the chosen OAuth app
// for site items, or inferred from the account domain for credential items
// with no URL (e.g. "me@gmail.com" renders a Google chip) — else the item's
// initial.
// Tailwind only ships classes it can see, so the two sizes are spelled out
// rather than interpolated.
export function itemIcon(it: ItemMeta, big = false) {
  const box = big ? "h-12 w-12" : "h-10 w-10";
  const size = big ? 12 : 10;
  if (it.favicon) {
    return <img className={`${box} flex-shrink-0 rounded-control object-contain`} src={it.favicon} alt="" />;
  }
  const provider = providerOf(it);
  if (provider) {
    return (
      <span className={`${box} flex flex-shrink-0 items-center justify-center rounded-control bg-surface-container-high`}>
        <MethodChip method={provider} size={size * 2.4} />
      </span>
    );
  }
  if (it.kind === "card") {
    return (
      <span className={`${box} flex flex-shrink-0 items-center justify-center rounded-control bg-surface-container-high`}>
        <CardBrandIcon bin={it.card_bin} size={size * 2.6} />
      </span>
    );
  }
  if (it.kind === "note") {
    return (
      <span className={`${box} flex flex-shrink-0 items-center justify-center rounded-control bg-surface-container-high text-on-surface-variant`}>
        <NoteIcon size={size * 1.8} />
      </span>
    );
  }
  return (
    <span className={`${box} flex flex-shrink-0 items-center justify-center rounded-control bg-surface-container-high text-body-md font-semibold text-on-surface-variant`}>
      {(it.title || "?").charAt(0).toUpperCase()}
    </span>
  );
}

/** Pinned items get the card treatment; everything else stays a list row. */
export function PinnedTiles({
  items,
  onView,
  onTogglePin,
}: {
  items: ItemMeta[];
  onView: (item: ItemMeta) => void;
  onTogglePin?: (item: ItemMeta) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
      {items.map((it) => (
        <div key={it.id} className="card group relative flex flex-col items-center gap-2 p-4 text-center">
          <button
            type="button"
            onClick={() => onView(it)}
            aria-label={`View ${it.title}`}
            className="flex flex-col items-center gap-2"
          >
            {itemIcon(it, true)}
            <span className="w-full truncate text-body-md font-medium text-on-surface">{it.title}</span>
            {it.username && (
              <span className="w-full truncate font-mono text-body-sm text-on-surface-variant">{it.username}</span>
            )}
          </button>
          {onTogglePin && (
            <button
              type="button"
              onClick={() => onTogglePin(it)}
              aria-label={`Unpin ${it.title}`}
              title="Unpin"
              className="absolute right-1.5 top-1.5 rounded-control p-1.5 text-primary opacity-0 transition-opacity duration-150 ease-out hover:bg-white/6 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <PinIcon size={14} filled />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemActions({
  item,
  onEdit,
  onDelete,
  onOpen,
  onTogglePin,
}: {
  item: ItemMeta;
  onEdit?: (item: ItemMeta) => void;
  onDelete: (item: ItemMeta) => void;
  onOpen?: (id: string) => void;
  onTogglePin?: (item: ItemMeta) => void;
}) {
  return (
    <span className="flex flex-shrink-0 items-center gap-1">
      {onTogglePin && (
        <button
          type="button"
          onClick={() => onTogglePin(item)}
          aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.title}`}
          title={item.pinned ? "Unpin" : "Pin to the top"}
          className={`rounded-control p-1.5 transition-colors duration-150 ease-out hover:bg-white/4 hover:text-primary ${
            item.pinned
              ? "text-primary"
              : "text-on-surface-variant opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        >
          <PinIcon size={14} filled={item.pinned} />
        </button>
      )}
      <span className="flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
        {item.kind === "login" && onOpen && (
          <button
            type="button"
            onClick={() => onOpen(item.id)}
            aria-label={`Open ${item.title}`}
            title="Open in browser"
            className="rounded-control p-1.5 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-white/4 hover:text-secondary"
          >
            <ExternalIcon size={14} />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(item)}
            aria-label={`Edit ${item.title}`}
            title={`Edit ${item.title}`}
            className="rounded-control p-1.5 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-white/4 hover:text-primary"
          >
            <PencilIcon size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(item)}
          aria-label={`Delete ${item.title}`}
          title={`Delete ${item.title}`}
          className="rounded-control p-1.5 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-error/12 hover:text-error"
        >
          <TrashIcon size={14} />
        </button>
      </span>
    </span>
  );
}

export default function ItemList({
  items,
  onView,
  onEdit,
  onDelete,
  onOpen,
  onTogglePin,
  emptyLabel,
  compact,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<ItemMeta | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-on-surface-variant">
        <DatabaseIcon size={28} />
        <p className="text-body-md">{emptyLabel ?? "No items yet"}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {items.map((it) => {
          const provider = providerOf(it);
          return (
            <li
              key={it.id}
              className={`group flex items-center gap-3 rounded-control transition-colors duration-150 ease-out hover:bg-surface-container-high ${
                compact ? "px-2 py-1.5" : "px-3 py-2.5"
              }`}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => onView(it)}
                aria-label={`View ${it.title}`}
              >
                {itemIcon(it)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-md font-medium text-on-surface">{it.title}</span>
                  {provider && it.username && (
                    <span className="block truncate font-mono text-body-sm text-on-surface-variant">
                      {it.username}
                    </span>
                  )}
                </span>
                {!compact && <span className="label-md flex-shrink-0">{formatStamp(it.updated_at)}</span>}
              </button>
              <ItemActions
                item={it}
                onEdit={onEdit}
                onDelete={setPendingDelete}
                onOpen={onOpen}
                onTogglePin={onTogglePin}
              />
            </li>
          );
        })}
      </ul>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete item"
          message={`Delete "${pendingDelete.title}"? This can't be undone.`}
          typeToConfirm="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}
