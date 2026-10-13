import { useState, useEffect } from "react";
import LeakCheck from "../components/LeakCheck";
import { api } from "../lib/api";
import type { VaultStats } from "../lib/types";

const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// One ink arc as long as the score, so the filled share of the ring is the
// number in the middle. The tiers are spelled out beside it in words.
function HealthRing({ score }: { score: number }) {
  const length = (RING_CIRCUMFERENCE * Math.max(0, Math.min(100, score))) / 100;
  return (
    <div
      className="relative flex h-[104px] w-[104px] flex-shrink-0 items-center justify-center"
      role="img"
      aria-label={`Health score ${score}%`}
    >
      <svg width={104} height={104} viewBox="0 0 104 104" className="-rotate-90" aria-hidden>
        <circle cx={52} cy={52} r={RING_RADIUS} fill="none" stroke="var(--color-outline-variant)" strokeWidth={8} />
        <circle
          cx={52}
          cy={52}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          strokeDasharray={`${length} ${RING_CIRCUMFERENCE - length}`}
          className="text-on-surface transition-[stroke-dasharray] duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-headline-md leading-none text-on-surface">{score}%</span>
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

type IssueTag = "weak" | "reused" | "old";

const TAG_LABEL: Record<IssueTag, string> = {
  weak: "Weak",
  reused: "Reused",
  old: "Stale",
};

interface Issue {
  id: string;
  title: string;
  tags: IssueTag[];
}

// Same login can be weak AND reused AND stale; merge by id so it shows once
// with every reason attached, instead of three disconnected lists.
function buildIssues(stats: VaultStats): Issue[] {
  const byId = new Map<string, Issue>();
  const add = (items: VaultStats["weak"], tag: IssueTag) => {
    for (const item of items) {
      const issue = byId.get(item.id) ?? { id: item.id, title: item.title, tags: [] };
      issue.tags.push(tag);
      byId.set(item.id, issue);
    }
  };
  add(stats.weak, "weak");
  add(stats.reused, "reused");
  add(stats.old, "old");
  return [...byId.values()];
}

function IssueList({ issues, onViewItem }: { issues: Issue[]; onViewItem: (id: string) => void }) {
  if (issues.length === 0) {
    return (
      <div className="card flex flex-col gap-1 p-6">
        <h2 className="text-body-md font-semibold text-on-surface">Needs attention</h2>
        <p className="text-body-sm text-on-surface-variant">No weak, reused, or stale passwords found.</p>
      </div>
    );
  }
  return (
    <div className="card flex flex-col gap-2 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-body-md font-semibold text-on-surface">Needs attention</h2>
        <span className="label-sm flex-shrink-0">{issues.length}</span>
      </div>
      {/* Capped height so a vault with hundreds of flagged logins scrolls
          inside the card instead of stretching the page. */}
      <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
        {issues.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              onClick={() => onViewItem(issue.id)}
              className="flex w-full items-center justify-between gap-3 rounded-control px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-surface-container-high"
            >
              <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">{issue.title}</span>
              <span className="flex flex-shrink-0 gap-2">
                {/* Weak and reused are the tape's job; stale is only a note. */}
                {issue.tags.map((tag) => (
                  <span key={tag} className={tag === "old" ? "label-md self-center" : "flag"}>
                    {TAG_LABEL[tag]}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Stats({ onViewItem }: { onViewItem: (id: string) => void }) {
  const [stats, setStats] = useState<VaultStats | null>(null);

  useEffect(() => {
    api.vaultStats().then(setStats);
  }, []);

  if (!stats) return null;

  const issues = buildIssues(stats);
  // A weak password is the worst tier; reused/stale alone is moderate.
  const weakCount = issues.filter((i) => i.tags.includes("weak")).length;
  const moderateCount = issues.length - weakCount;
  const goodCount = Math.max(0, stats.logins - issues.length);
  const tiers = [
    { label: "Strong", count: goodCount, hint: "No issues found." },
    {
      label: "Moderate",
      count: moderateCount,
      hint: "Password is strong enough on its own, but it is reused on another login or has not been changed in over 90 days.",
    },
    {
      label: "Weak",
      count: weakCount,
      hint: "Under 8 characters, or built from fewer than 3 of: lowercase, uppercase, digits, symbols.",
    },
  ];

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-8 py-8">
      <h1 className="text-headline-lg text-on-surface">Vault health</h1>

      <div className="card flex items-center gap-6 p-6">
        <HealthRing score={stats.health_score} />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-body-md font-semibold text-on-surface">Health score</p>
          <p className="text-body-sm text-on-surface-variant">
            {issues.length === 0
              ? "No weak, reused, or stale passwords."
              : `${issues.length} login${issues.length === 1 ? "" : "s"} need attention — see below.`}
          </p>
          <div className="flex flex-wrap gap-3">
            {tiers.map((t) => (
              <span
                key={t.label}
                title={t.hint}
                className={`cursor-help text-body-sm ${
                  t.label === "Weak" && t.count > 0 ? "font-medium text-error" : "text-on-surface-variant"
                }`}
              >
                {t.count} {t.label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </div>

      <CountRow stats={stats} />

      <IssueList issues={issues} onViewItem={onViewItem} />

      <LeakCheck onViewItem={onViewItem} />
    </div>
  );
}
