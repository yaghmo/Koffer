import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COUNTRIES, COUNTRIES_BY_NAME } from "../lib/countries";
import { useHotkey } from "../lib/useHotkey";

export default function CountrySelect({
  dial,
  onChange,
}: {
  dial: string;
  onChange: (dial: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [activeIso, setActiveIso] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Type-ahead buffer: consecutive letters within 800ms compose one query
  // ("f", then "fr" -> France), same as a native <select>.
  const typed = useRef({ buf: "", at: 0 });
  // Shown alphabetically; COUNTRIES keeps its curated order elsewhere.
  const list = useMemo(() => COUNTRIES_BY_NAME(), []);

  // The trigger and popover are no longer DOM-adjacent once portaled, so
  // outside-click detection has to check both refs itself.
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);
  useHotkey("escape", () => setOpen(false), open);

  // The list has to hold focus for type-ahead keys to reach it.
  useEffect(() => {
    if (open) popoverRef.current?.focus();
  }, [open, rect]);

  function jumpTo(iso2: string) {
    setActiveIso(iso2);
    popoverRef.current
      ?.querySelector(`[data-iso="${iso2}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      const hit = list.find((c) => c.iso2 === activeIso);
      if (hit) {
        e.preventDefault();
        onChange(hit.dial);
        setOpen(false);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = list.findIndex((c) => c.iso2 === activeIso);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      const bounded = Math.min(list.length - 1, Math.max(0, next < 0 ? 0 : next));
      jumpTo(list[bounded].iso2);
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
    const now = Date.now();
    const sameKeyAgain = now - typed.current.at <= 800 && typed.current.buf === e.key;
    typed.current.buf = now - typed.current.at > 800 || sameKeyAgain ? e.key : typed.current.buf + e.key;
    typed.current.at = now;
    const q = typed.current.buf.toLowerCase();
    const matches = list.filter(
      (c) => c.name.toLowerCase().startsWith(q) || c.iso2.toLowerCase().startsWith(q),
    );
    if (matches.length === 0) return;
    // Repeating one letter walks through every country starting with it
    // instead of sticking on the first — "a, a, a" steps Albania, Algeria,
    // Argentina.
    const at = matches.findIndex((c) => c.iso2 === activeIso);
    const pick = sameKeyAgain && at >= 0 ? matches[(at + 1) % matches.length] : matches[0];
    jumpTo(pick.iso2);
  }

  const current = COUNTRIES.find((c) => c.dial === dial) ?? COUNTRIES[0];

  function toggle() {
    if (!open && triggerRef.current) {
      typed.current = { buf: "", at: 0 };
      setActiveIso(current.iso2);
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label="Country code"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="field flex w-[104px] flex-shrink-0 items-center gap-1.5 text-left"
      >
        <span className="label-sm rounded bg-surface-container-high px-1 py-0.5 text-on-surface-variant">
          {current.iso2}
        </span>
        <span className="text-body-sm text-on-surface">{current.dial}</span>
      </button>
      {open && rect &&
        createPortal(
          // Rendered at document.body, not inside the field's .card: a card
          // uses backdrop-blur, which opens its own stacking context and
          // would otherwise trap this dropdown behind the next sibling card.
          <div
            ref={popoverRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            aria-activedescendant={activeIso ? `country-${activeIso}` : undefined}
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
            className="z-50 max-h-64 overflow-y-auto rounded-control border border-outline-variant bg-surface shadow-lg"
          >
            {list.map((c) => (
              <button
                key={c.iso2}
                id={`country-${c.iso2}`}
                data-iso={c.iso2}
                type="button"
                role="option"
                aria-selected={c.dial === dial}
                onClick={() => {
                  onChange(c.dial);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm transition-colors duration-150 ease-out hover:bg-surface-container-high ${
                  c.dial === dial ? "font-medium text-on-surface" : "text-on-surface"
                } ${c.iso2 === activeIso ? "bg-surface-container-high" : ""}`}
              >
                <span className="label-sm w-8 flex-shrink-0 rounded bg-surface-container-high px-1 py-0.5 text-center text-on-surface-variant">
                  {c.iso2}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-on-surface-variant">{c.dial}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
