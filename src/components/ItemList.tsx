import type { ItemMeta } from "../lib/types";
import { PencilIcon, TrashIcon, ExternalIcon } from "./Icon";
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
// (e.g. "me@gmail.com" renders a Google chip).
function rowIcon(it: ItemMeta) {
  if (it.favicon) return <img className="favicon" src={it.favicon} alt="" />;
  if (it.kind === "login") {
    const provider =
      it.method !== "credentials" ? it.method : providerForAccount(it.username ?? "");
    if (provider) return <MethodChip method={provider} />;
  }
  return <span className={`kind kind-${it.kind}`}>{it.kind}</span>;
}

export default function ItemList({ items, onView, onEdit, onDelete, onOpen }: Props) {
  if (items.length === 0) {
    return <p className="empty">No items yet · add your first one</p>;
  }
  return (
    <ul className="item-list">
      {items.map((it) => {
        // Provider identity: explicit method wins, else inferred from the
        // account domain (e.g. "me@gmail.com" → google) so credential
        // accounts created via "+ Add new account" brand like the provider.
        const provider =
          it.kind === "login" && it.method !== "credentials"
            ? it.method
            : it.kind === "login"
              ? providerForAccount(it.username ?? "")
              : null;
        return (
        <li key={it.id}>
          <button
            className="row"
            onClick={() => onView(it)}
            aria-label={`View ${it.title}`}
          >
            {rowIcon(it)}
            <span className="title">{it.title}</span>
            {provider && it.username && (
              <span className="account">{it.username}</span>
            )}
            {provider && (
              <span className="provider">{provider}</span>
            )}
            <span className="meta">{formatStamp(it.updated_at)}</span>
          </button>
          {it.kind === "login" && onOpen && (
            <button
              className="edit open"
              onClick={() => onOpen(it.id)}
              aria-label={`Open ${it.title}`}
              title="Open in browser"
            >
              <ExternalIcon />
            </button>
          )}
          {onEdit && (
            <button
              className="edit"
              onClick={() => onEdit(it)}
              aria-label={`Edit ${it.title}`}
              title={`Edit ${it.title}`}
            >
              <PencilIcon />
            </button>
          )}
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
        );
      })}
    </ul>
  );
}