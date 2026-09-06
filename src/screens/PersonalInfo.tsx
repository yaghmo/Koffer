import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { PersonalInfo } from "../lib/types";
import { CheckIcon } from "../components/Icon";

// Field metadata: label + optional fill target hint used by the extension.
const FIELDS: { key: keyof PersonalInfo; label: string; placeholder?: string }[] = [
  { key: "name", label: "Full name", placeholder: "Ada Lovelace" },
  { key: "username", label: "Username", placeholder: "adaloves" },
  { key: "email", label: "Main email", placeholder: "you@example.com" },
  { key: "phone", label: "Phone", placeholder: "+1 555 123 4567" },
  { key: "address", label: "Street address", placeholder: "1 Maths Rd, Apt 4" },
  { key: "city", label: "City", placeholder: "London" },
  { key: "state", label: "State / Province", placeholder: "—" },
  { key: "zip", label: "ZIP / Postal code", placeholder: "W1T 3AL" },
  { key: "country", label: "Country", placeholder: "United Kingdom" },
  { key: "date_of_birth", label: "Date of birth", placeholder: "1985-04-12" },
  { key: "website", label: "Portfolio / Website", placeholder: "https://example.com" },
  { key: "github", label: "GitHub", placeholder: "yourhandle" },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/yourname" },
  { key: "current_title", label: "Current job title", placeholder: "Senior Engineer" },
  { key: "current_company", label: "Current company", placeholder: "Acme Corp" },
  { key: "years_experience", label: "Years of experience", placeholder: "8" },
  { key: "school", label: "School / University", placeholder: "State University" },
  { key: "degree", label: "Degree / Major", placeholder: "BSc Computer Science" },
  { key: "desired_salary", label: "Desired salary", placeholder: "120000" },
];

const empty = (): PersonalInfo => ({
  name: "", username: "", email: "", phone: "", address: "", city: "", state: "",
  zip: "", country: "", date_of_birth: "", website: "", github: "", linkedin: "",
  current_title: "", current_company: "", years_experience: "", school: "",
  degree: "", desired_salary: "",
});

// Strip anything that can't be part of the field's format as the user types.
// Keeps invalid characters from ever entering the value.
function sanitize(key: keyof PersonalInfo, value: string): string {
  switch (key) {
    case "phone":
      return value.replace(/[^+\d\s().-]/g, "").slice(0, 20);
    case "zip":
      return value.replace(/[^A-Za-z0-9\s-]/g, "").toUpperCase().slice(0, 12);
    case "years_experience":
      return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 5);
    case "desired_salary":
      return value.replace(/[^\d,]/g, "").slice(0, 12);
    default:
      return value;
  }
}

// Native `<input type="date">` renders the browser calendar; its value is
// always "YYYY-MM-DD". Regex fields get `inputType` hints so the OS keyboard
// matches too.
function inputFor(key: keyof PersonalInfo): { type: string; inputMode?: "numeric" | "decimal" } {
  switch (key) {
    case "email":
      return { type: "email" };
    case "phone":
      return { type: "tel" };
    case "date_of_birth":
      return { type: "date" };
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
    if (profile.phone && !/^[+\d][\d\s().-]{5,}$/.test(profile.phone)) {
      errors.phone = "Not a valid phone number.";
    }
    if (profile.website && profile.website !== "https://" && !/^https?:\/\/\S+$/.test(profile.website)) {
      errors.website = "Website must start with http:// or https://";
    }
    if (profile.date_of_birth) {
      const d = new Date(`${profile.date_of_birth}T00:00:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.date_of_birth) || Number.isNaN(d.getTime())) {
        errors.date_of_birth = "Pick a valid date.";
      }
    }
    if (profile.years_experience && !/^\d+(\.\d+)?$/.test(profile.years_experience)) {
      errors.years_experience = "Number only, e.g. 8 or 3.5.";
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
      await api.savePersonalInfo(profile);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <div className="settings-header">
        <div>
          <p className="screen-eyebrow">Personal info</p>
          <h1 className="screen-title">Your identity profile</h1>
        </div>
      </div>

      <form
        className="settings-section"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="settings-description">
          One profile for your vault. Used to fill login and signup forms — name,
          email, phone, and your socials — in the browser autofill.
        </p>
        <div className="fields">
          {FIELDS.map((f) => {
            const inputProps = inputFor(f.key);
            return (
            <div className="field" key={f.key}>
              <p className="field-label">{f.label}</p>
              <div className="field-row">
                <input
                  value={profile[f.key]}
                  onChange={(e) =>
                    setProfile({ ...profile, [f.key]: sanitize(f.key, e.target.value) })
                  }
                  aria-label={f.label}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={f.key === "date_of_birth" ? undefined : f.placeholder}
                  {...inputProps}
                />
              </div>
              {fieldErrors[f.key] && (
                <p className="field-error" role="alert">{fieldErrors[f.key]}</p>
              )}
            </div>
            );
          })}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {saved ? <CheckIcon size={14} /> : null}
          {busy ? "Saving…" : saved ? "Saved" : "Save profile"}
        </button>
      </form>
    </div>
  );
}