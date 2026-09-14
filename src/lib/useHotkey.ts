import { useEffect } from "react";

type Combo = "ctrl+k" | "ctrl+s" | "escape";

export function useHotkey(combo: Combo, handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const matches =
        combo === "escape"
          ? key === "escape"
          : (e.ctrlKey || e.metaKey) && key === combo.slice("ctrl+".length);
      if (!matches) return;
      e.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo, handler, enabled]);
}
