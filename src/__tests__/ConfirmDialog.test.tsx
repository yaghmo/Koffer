import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfirmDialog from "../components/ConfirmDialog";

const noop = () => {};

describe("ConfirmDialog", () => {
  it("tapes a destructive dialog and confirms in ink under the action's name", () => {
    const { container } = render(
      <ConfirmDialog title="Delete GitHub?" message="There is no undo." confirmLabel="Delete login" onConfirm={noop} onCancel={noop} />,
    );
    expect(container.querySelector(".dialog-danger")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Delete login" });
    expect(confirm.className).toContain("btn-ink");
    expect(confirm.className).not.toContain("btn-primary");
  });

  it("leaves an ordinary question untaped, with the red primary", () => {
    const { container } = render(
      <ConfirmDialog title="Update?" message="Koffer restarts." confirmLabel="Update" tone="primary" onConfirm={noop} onCancel={noop} />,
    );
    expect(container.querySelector(".dialog-danger")).toBeNull();
    expect(screen.getByRole("button", { name: "Update" }).className).toContain("btn-primary");
  });
});
