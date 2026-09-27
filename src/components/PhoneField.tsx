import CountrySelect from "./CountrySelect";
import { formatPhoneLocal, splitPhone } from "../lib/phone";
import { logUi } from "../lib/log";

/**
 * A country picker and a number box over one stored "+dial local" string.
 *
 * Two screens need it — personal info, and a login that signs in with a
 * phone number instead of a username — and the fiddly parts are not obvious:
 * the number is regrouped on the way out so a number saved before the
 * grouping existed still displays with it, and the dial code survives the
 * number being cleared, or emptying the box would snap the country back to
 * the +1 default under the user's hands.
 */
export default function PhoneField({
  value,
  onChange,
  ariaLabel,
  placeholder = "555-123-4567",
  logScope,
  inputProps,
}: {
  value: string;
  onChange: (phone: string) => void;
  ariaLabel: string;
  placeholder?: string;
  logScope?: string;
  inputProps?: Record<string, unknown>;
}) {
  const { dial, local } = splitPhone(value);

  return (
    <div className="flex gap-2">
      <CountrySelect
        dial={dial}
        onChange={(newDial) => {
          const regrouped = formatPhoneLocal(local, newDial);
          if (logScope) logUi("info", logScope, "phone country changed");
          onChange(regrouped ? `${newDial} ${regrouped}` : newDial);
        }}
      />
      <input
        value={formatPhoneLocal(local, dial)}
        onChange={(e) => {
          const next = formatPhoneLocal(e.target.value, dial);
          onChange(next ? `${dial} ${next}` : dial);
        }}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        className="field flex-1"
        {...inputProps}
      />
    </div>
  );
}
