import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { VaultStats } from "../lib/types";

const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function HealthRing({ score }: { score: number }) {
  const offset = RING_CIRCUMFERENCE * (1 - score / 100);
  return (
    <div className="relative flex h-[104px] w-[104px] items-center justify-center">
      <svg width={104} height={104} viewBox="0 0 104 104" className="-rotate-90">
        <circle cx={52} cy={52} r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={8} />
        <circle
          cx={52}
          cy={52}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="text-primary transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-headline-lg text-on-surface">{score}</span>
    </div>
  );
}

function CountRow({ stats }: { stats: VaultStats }) {
  const counts = [
    { label: "Total", value: stats.total },
    { label: "Logins", value: stats.logins },
    { label: "Notes", value: stats.notes },
    { label: "Cards", value: stats.cards },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {counts.map(({ label, value }) => (
        <div key={label} className="card flex flex-col items-center gap-1 p-4">
          <span className="text-headline-md text-on-surface">{value}</span>
          <span className="label-sm">{label}</span>
        </div>
      ))}
    </div>
  );
}

function FlaggedList({ title, items }: { title: string; items: VaultStats["weak"] }) {
  if (items.length === 0) return null;
  return (
    <div className="card flex flex-col gap-2 p-5">
      <h2 className="text-body-md font-semibold text-on-surface">{title}</h2>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="text-body-sm text-on-surface-variant">
            {item.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState<VaultStats | null>(null);

  useEffect(() => {
    api.vaultStats().then(setStats);
  }, []);

  if (!stats) return null;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-8 py-8">
      <div>
        <p className="label-sm">Stats</p>
        <h1 className="text-headline-lg text-on-surface">Vault health</h1>
      </div>

      <div className="card flex items-center gap-6 p-6">
        <HealthRing score={stats.health_score} />
        <div className="flex flex-col gap-1">
          <p className="text-body-md font-semibold text-on-surface">Health score</p>
          <p className="text-body-sm text-on-surface-variant">
            Share of logins with no weak, reused, or stale password.
          </p>
        </div>
      </div>

      <CountRow stats={stats} />

      <FlaggedList title="Weak passwords" items={stats.weak} />
      <FlaggedList title="Reused passwords" items={stats.reused} />
      <FlaggedList title="Not updated in 90+ days" items={stats.old} />
    </div>
  );
}
