import type { ReactNode } from "react";
import { Emblem } from "./Emblem";

/** The jacket beside screens that have no navigation yet: loading, the lock
 *  screen and vault setup. As wide as the sidebar, so unlocking moves nothing. */
export default function JacketFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen">
      <aside className="jacket flex w-[220px] shrink-0 items-start gap-3 px-4 py-4">
        <Emblem size={28} />
        <p className="text-body-md font-semibold">Koffer</p>
      </aside>
      <main className="h-full flex-1 overflow-y-auto bg-surface">{children}</main>
    </div>
  );
}
