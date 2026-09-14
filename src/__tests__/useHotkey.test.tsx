import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHotkey } from "../lib/useHotkey";

function fireKey(key: string, ctrlKey = true) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true }));
}

describe("useHotkey", () => {
  it("fires the handler when the combo matches", () => {
    const handler = vi.fn();
    renderHook(() => useHotkey("ctrl+k", handler));
    act(() => fireKey("k"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores keys that do not match the combo", () => {
    const handler = vi.fn();
    renderHook(() => useHotkey("ctrl+k", handler));
    act(() => fireKey("j"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("does nothing when enabled is false", () => {
    const handler = vi.fn();
    renderHook(() => useHotkey("ctrl+k", handler, false));
    act(() => fireKey("k"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("matches escape without a modifier", () => {
    const handler = vi.fn();
    renderHook(() => useHotkey("escape", handler));
    act(() => fireKey("Escape", false));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
