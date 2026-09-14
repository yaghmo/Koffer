import type { ItemMeta } from "../lib/types";
import { PencilIcon, TrashIcon, ExternalIcon, DatabaseIcon } from "./Icon";
import { MethodChip, providerForAccount } from "../lib/methods";

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

// Row icon: site favicon wins, else provider chip — from the chosen OAuth app
// for site items, or inferred from the account domain for credential items
// (e.g. "me@gmail.com" renders a Google chip) — else the item's initial.
function rowIcon(it: ItemMeta) {
  if (it.favicon) {
    return <img className="h-10 w-10 flex-shrink-0 rounded-control object-contain" src={it.favicon} alt="" />;
  }
  if (it.kind === "login") {
    const provider = it.method !== "credentials" ? it.method : providerForAccount(it.username ?? "");
    if (provider) {
      return (
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-surface-container-high">
          <MethodChip method={provider} size={24} />
        </span>
      );
    }
  }
  return (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-surface-container-high text-body-md font-semibold text-on-surface-variant">
      {(it.title || "?").charAt(0).toUpperCase()}
    </span>
  );
}

export default function ItemList({ items, onView, onEdit, onDelete, onOpen }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-on-surface-variant">
        <DatabaseIcon size={28} />
        <p className="text-body-md">No items yet</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => {
        const provider =
          it.kind === "login" && it.method !== "credentials"
            ? it.method
            : it.kind === "login"
              ? providerForAccount(it.username ?? "")
              : null;
        return (
          <li
            key={it.id}
            className="group flex items-center gap-3 rounded-control px-3 py-2.5 transition-colors duration-150 ease-out hover:bg-surface-container-high"
          >
            <button
              type="button"
              className="flex flex-1 items-center gap-3 text-left"
              onClick={() => onView(it)}
              aria-label={`View ${it.title}`}
            >
              {rowIcon(it)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-md font-medium text-on-surface">{it.title}</span>
                {provider && it.username && (
                  <span className="block truncate font-mono text-body-sm text-on-surface-variant">
                    {it.username}
                  </span>
                )}
              </span>
              <span className="label-md flex-shrink-0">{formatStamp(it.updated_at)}</span>
            </button>
            <span className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
              {it.kind === "login" && onOpen && (
                <button
                  type="button"
                  onClick={() => onOpen(it.id)}
                  aria-label={`Open ${it.title}`}
                  title="Open in browser"
                  className="rounded-control p-1.5 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-white/4 hover:text-secondary"
                >
                  <ExternalIcon size={14} />
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(it)}
                  aria-label={`Edit ${it.title}`}
                  title={`Edit ${it.title}`}
                  className="rounded-control p-1.5 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-white/4 hover:text-primary"
                >
                  <PencilIcon size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${it.title}"?`)) onDelete(it.id);
                }}
                aria-label={`Delete ${it.title}`}
                title={`Delete ${it.title}`}
                className="rounded-control p-1.5 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-error/12 hover:text-error"
              >
                <TrashIcon size={14} />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
