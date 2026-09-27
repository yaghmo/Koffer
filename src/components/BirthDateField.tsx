import { useEffect, useRef, useState } from "react";
import { CalendarIcon } from "./Icon";

type Part = "day" | "month" | "year";
type Parts = Record<Part, string>;

/** Year first: typing it is the quick way to a date decades back. */
const ORDER: Part[] = ["year", "month", "day"];
const LEN: Record<Part, number> = { day: 2, month: 2, year: 4 };
const LABEL: Parts = { day: "Day", month: "Month", year: "Year" };
const HINT: Parts = { day: "DD", month: "MM", year: "YYYY" };

function split(value: string): Parts {
  const [year = "", month = "", day = ""] = value ? value.split("-") : [];
  return { year, month, day };
}

/**
 * "YYYY-MM-DD" once every part is in. A part-typed date is passed on as it
 * stands, which the screen's check refuses, rather than as nothing, which
 * would save quietly without it.
 */
export function joinDate({ year, month, day }: Parts): string {
  if (!year && !month && !day) return "";
  if (year.length === 4 && month && day) return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return `${year}-${month}-${day}`;
}

/**
 * Where the calendar should open: the typed year, with the month and day
 * when there are any, else the first of it. Empty until a year is in, which
 * opens it on today.
 */
export function pickerStart({ year, month, day }: Parts): string {
  if (year.length !== 4) return "";
  const mm = Math.min(Math.max(Number(month) || 1, 1), 12);
  const dd = Math.min(Math.max(Number(day) || 1, 1), 28);
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/**
 * A date of birth: year, month and day boxes over one "YYYY-MM-DD" string,
 * and the calendar behind a button.
 *
 * A plain `<input type="date">` opens its calendar on this month whatever
 * year has been typed -- a part-typed date has no value to open on -- which
 * left a birthday decades of scrolling away. Here the year goes in first and
 * the calendar opens on it. A full box moves on to the next.
 */
export default function BirthDateField({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [parts, setParts] = useState(() => split(value));
  const boxes = useRef<Partial<Record<Part, HTMLInputElement | null>>>({});
  const picker = useRef<HTMLInputElement | null>(null);

  // A value loaded from the vault after the first render.
  useEffect(() => {
    if (value !== joinDate(parts)) setParts(split(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function update(next: Parts) {
    setParts(next);
    onChange(joinDate(next));
  }

  function set(part: Part, raw: string) {
    const next = { ...parts, [part]: raw.replace(/\D/g, "").slice(0, LEN[part]) };
    update(next);
    const after = ORDER[ORDER.indexOf(part) + 1];
    if (after && next[part].length === LEN[part]) boxes.current[after]?.focus();
  }

  function openCalendar() {
    const el = picker.current;
    if (!el) return;
    el.value = pickerStart(parts);
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  return (
    <div className="relative flex gap-2">
      {ORDER.map((part) => (
        <input
          key={part}
          ref={(el) => {
            boxes.current[part] = el;
          }}
          value={parts[part]}
          onChange={(e) => set(part, e.target.value)}
          aria-label={`${LABEL[part]} of birth`}
          placeholder={HINT[part]}
          inputMode="numeric"
          autoComplete="off"
          className={`field ${part === "year" ? "w-24" : "w-16"} text-center`}
        />
      ))}
      <button
        type="button"
        onClick={openCalendar}
        aria-label="Pick the date from a calendar"
        title="Calendar (opens on the year typed)"
        className="btn-secondary px-3"
      >
        <CalendarIcon />
      </button>
      {/* The engine's own calendar, with nothing of its box on show. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => e.target.value && update(split(e.target.value))}
        className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
      />
    </div>
  );
}
