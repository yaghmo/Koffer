import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { PersonalInfo } from "../lib/types";
import { CheckIcon, UserIcon } from "../components/Icon";
import { useHotkey } from "../lib/useHotkey";
import { isValidPhone, splitPhone } from "../lib/phone";
import PhoneField from "../components/PhoneField";
import BirthDateField from "../components/BirthDateField";

// Field metadata: label + optional fill target hint used by the extension.
type Group = "Basics" | "Address" | "Online" | "Work & education";

const FIELDS: { key: keyof PersonalInfo; label: string; placeholder?: string; group: Group; required?: boolean }[] = [
  { key: "name", label: "Full name", placeholder: "Ada Lovelace", group: "Basics", required: true },
  { key: "username", label: "Username", placeholder: "adaloves", group: "Basics" },
  { key: "email", label: "Main email", placeholder: "you@example.com", group: "Basics", required: true },
  { key: "phone", label: "Phone", placeholder: "+1 555-123-4567", group: "Basics" },
  { key: "date_of_birth", label: "Date of birth", placeholder: "1985-04-12", group: "Basics" },
  { key: "address", label: "Street address", placeholder: "1 Maths Rd, Apt 4", group: "Address" },
  { key: "city", label: "City", placeholder: "London", group: "Address" },
  { key: "state", label: "State / Province", placeholder: "—", group: "Address" },
  { key: "zip", label: "ZIP / Postal code", placeholder: "W1T 3AL", group: "Address" },
  { key: "country", label: "Country", placeholder: "United Kingdom", group: "Address" },
  { key: "website", label: "Portfolio / Website", placeholder: "https://example.com", group: "Online" },
  { key: "github", label: "GitHub", placeholder: "yourhandle or github.com/yourhandle", group: "Online" },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/yourname", group: "Online" },
  { key: "current_title", label: "Current job title", placeholder: "Senior Engineer", group: "Work & education" },
  { key: "current_company", label: "Current company", placeholder: "Acme Corp", group: "Work & education" },
  { key: "years_experience", label: "Years of experience", placeholder: "8", group: "Work & education" },
  { key: "school", label: "School / University", placeholder: "State University", group: "Work & education" },
  { key: "degree", label: "Degree / Major", placeholder: "BSc Computer Science", group: "Work & education" },
  { key: "desired_salary", label: "Desired salary", placeholder: "120000", group: "Work & education" },
];

const GROUPS: Group[] = ["Basics", "Address", "Online", "Work & education"];

const empty = (): PersonalInfo => ({
  name: "", username: "", email: "", phone: "", address: "", city: "", state: "",
  zip: "", country: "", date_of_birth: "", website: "", github: "", linkedin: "",
  current_title: "", current_company: "", years_experience: "", school: "",
  degree: "", desired_salary: "",
});

// Strip anything that can't be part of the field's format as the user types.
// Keeps invalid characters from ever entering the value.
export function sanitize(key: keyof PersonalInfo, value: string): string {
  switch (key) {
    case "email":
      // Addresses are case-insensitive in practice and never hold spaces.
      return value.replace(/\s/g, "").toLowerCase().slice(0, 120);
    case "zip":
      return value.replace(/[^A-Za-z0-9\s-]/g, "").toUpperCase().slice(0, 12);
    case "years_experience":
      return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 5);
    case "desired_salary":
      return value.replace(/[^\d,]/g, "").slice(0, 12);
    case "name":
    case "city":
    case "state":
    case "country":
      // Names of people and places: letters (incl. accents) and the few
      // separators they really use. Keeps digits and punctuation out.
      return value.replace(/[^\p{L}\s.'-]/gu, "").slice(0, 60);
    case "github": {
      // A pasted profile link keeps just the handle; the extension turns it
      // back into a link for a form that asks for one.
      const link = /^\s*(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]*)/i.exec(value);
      return (link ? link[1] : value.replace(/\s/g, "")).slice(0, 39);
    }
    case "username":
      return value.replace(/\s/g, "").slice(0, 39);
    default:
      return value.slice(0, 120);
  }
}

// Regex fields get `inputType` hints so the OS keyboard matches too. The
// date of birth has boxes of its own (BirthDateField).
function inputFor(key: keyof PersonalInfo): { type: string; inputMode?: "numeric" | "decimal" } {
  switch (key) {
    case "email":
      return { type: "email" };
    case "phone":
      return { type: "tel" };
    case "years_experience":
      return { type: "text", inputMode: "decimal" };
    case "desired_salary":
      return { type: "text", inputMode: "numeric" };
    default:
      return { type: "text" };
  }
}

export default function PersonalInfoScreen() {
  const [profile, setProfile] = useState<PersonalInfo>(empty);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setProfile(empty());
    setError(null);
    api
      .getPersonalInfo()
      .then((p) => setProfile(p))
      .catch((err) => setError(String(err)));
  }, []);

  async function save() {
    setError(null);
    setSaved(false);
    const errors: Record<string, string> = {};
    if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
      errors.email = "Not a valid email address.";
    }
    if (profile.phone && !isValidPhone(profile.phone)) {
      errors.phone = "Not a valid phone number.";
    }
    if (profile.website && profile.website !== "https://" && !/^https?:\/\/\S+$/.test(profile.website)) {
      errors.website = "Website must start with http:// or https://";
    }
    if (profile.github && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(profile.github)) {
      errors.github = "Your GitHub handle, like octocat, or paste your profile link.";
    }
    if (profile.linkedin && !/^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/\S+$/i.test(profile.linkedin)) {
      errors.linkedin = "Must be a linkedin.com profile link.";
    }
    if (profile.date_of_birth) {
      const d = new Date(`${profile.date_of_birth}T00:00:00`);
      // 31 February rolls over into March rather than failing, so the day
      // has to come back as typed.
      const day = Number(profile.date_of_birth.slice(8));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.date_of_birth) || Number.isNaN(d.getTime()) || d.getDate() !== day) {
        errors.date_of_birth = "Pick a valid date.";
      } else if (d > new Date()) {
        errors.date_of_birth = "Date of birth can't be in the future.";
      } else if (d.getFullYear() < 1900) {
        errors.date_of_birth = "Date of birth looks wrong.";
      }
    }
    if (profile.years_experience && !/^\d+(\.\d+)?$/.test(profile.years_experience)) {
      errors.years_experience = "Number only, e.g. 8 or 3.5.";
    } else if (profile.years_experience && Number(profile.years_experience) > 80) {
      errors.years_experience = "That's more years than anyone has worked.";
    }
    if (profile.desired_salary && !/^\d[\d,]*$/.test(profile.desired_salary)) {
      errors.desired_salary = "Amount in digits only.";
    }
    for (const [k, v] of Object.entries(profile)) {
      if ((k === "name" || k === "email") && !v.trim()) {
        errors[k] = `${FIELDS.find((f) => f.key === k)?.label} is required.`;
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const phoneDigits = splitPhone(profile.phone).local.replace(/\D/g, "");
      await api.savePersonalInfo(phoneDigits ? profile : { ...profile, phone: "" });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useHotkey("ctrl+s", save);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-headline-lg text-on-surface">Your profile</h1>
          <p className="text-body-md text-on-surface-variant">
            Used to fill sign-up forms. Stays in your encrypted vault.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary flex-shrink-0"
          onClick={save}
          disabled={busy}
        >
          {saved ? <CheckIcon size={14} /> : <UserIcon size={14} />}
          {busy ? "Saving…" : saved ? "Saved" : "Save profile"}
        </button>
      </div>

      {GROUPS.map((group) => (
        <div key={group} className="card flex flex-col gap-4 p-6">
          <h2 className="text-body-md font-semibold text-on-surface">{group}</h2>
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.filter((f) => f.group === group).map((f) => {
              const inputProps = inputFor(f.key);
              const long = f.key === "address";
              return (
                <div className={`flex flex-col gap-1 ${long ? "col-span-2" : ""}`} key={f.key}>
                  <p className="label-md">
                    {f.label}
                    {f.required && <span className="text-on-surface"> *</span>}
                  </p>
                  {f.key === "date_of_birth" ? (
                    <BirthDateField
                      value={profile.date_of_birth}
                      onChange={(date_of_birth) => setProfile({ ...profile, date_of_birth })}
                    />
                  ) : f.key === "phone" ? (
                    <PhoneField
                      value={profile.phone}
                      onChange={(phone) => setProfile({ ...profile, phone })}
                      ariaLabel={f.label}
                      logScope="personal-info"
                      inputProps={inputProps}
                    />
                  ) : (
                    <input
                      value={profile[f.key]}
                      onChange={(e) => setProfile({ ...profile, [f.key]: sanitize(f.key, e.target.value) })}
                      aria-label={f.label}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={f.placeholder}
                      className="field"
                      {...inputProps}
                    />
                  )}
                  {fieldErrors[f.key] && (
                    <p role="alert" className="text-body-sm text-error">
                      {fieldErrors[f.key]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}