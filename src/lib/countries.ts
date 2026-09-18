export interface Country {
  iso2: string;
  dial: string;
  name: string;
  /** Digit grouping for the national number; falls back to groups of three. */
  groups?: number[];
  /** Italy is the notable country that keeps its leading 0 when dialed internationally. */
  keepTrunkZero?: boolean;
}

/**
 * The same countries in alphabetical order, for pickers. COUNTRIES itself
 * stays in its curated order because its first entry is the +1 default.
 */
export const COUNTRIES_BY_NAME = (): Country[] =>
  [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));

/** National-number grouping for a dial code, if a listed country defines one. */
export function groupsForDial(dial: string): number[] | undefined {
  return COUNTRIES.find((c) => c.dial === dial && c.groups)?.groups;
}

export function keepsTrunkZero(dial: string): boolean {
  return COUNTRIES.some((c) => c.dial === dial && c.keepTrunkZero);
}

// Dial codes for the countries most forms need. Not exhaustive (ITU has ~240
// entries with overlaps like NANP's shared +1) but covers every major market.
export const COUNTRIES: Country[] = [
  { iso2: "US", dial: "+1", name: "United States", groups: [3, 3, 4] },
  { iso2: "CA", dial: "+1", name: "Canada", groups: [3, 3, 4] },
  { iso2: "GB", dial: "+44", name: "United Kingdom" },
  { iso2: "IE", dial: "+353", name: "Ireland" },
  { iso2: "FR", dial: "+33", name: "France", groups: [1, 2, 2, 2, 2] },
  { iso2: "DE", dial: "+49", name: "Germany" },
  { iso2: "ES", dial: "+34", name: "Spain" },
  { iso2: "PT", dial: "+351", name: "Portugal" },
  { iso2: "IT", dial: "+39", name: "Italy", keepTrunkZero: true },
  { iso2: "NL", dial: "+31", name: "Netherlands" },
  { iso2: "BE", dial: "+32", name: "Belgium" },
  { iso2: "CH", dial: "+41", name: "Switzerland" },
  { iso2: "AT", dial: "+43", name: "Austria" },
  { iso2: "SE", dial: "+46", name: "Sweden" },
  { iso2: "NO", dial: "+47", name: "Norway" },
  { iso2: "DK", dial: "+45", name: "Denmark" },
  { iso2: "FI", dial: "+358", name: "Finland" },
  { iso2: "PL", dial: "+48", name: "Poland" },
  { iso2: "CZ", dial: "+420", name: "Czechia" },
  { iso2: "GR", dial: "+30", name: "Greece" },
  { iso2: "RO", dial: "+40", name: "Romania" },
  { iso2: "HU", dial: "+36", name: "Hungary" },
  { iso2: "UA", dial: "+380", name: "Ukraine" },
  { iso2: "RU", dial: "+7", name: "Russia" },
  { iso2: "TR", dial: "+90", name: "Turkey" },
  { iso2: "IL", dial: "+972", name: "Israel" },
  { iso2: "AE", dial: "+971", name: "United Arab Emirates" },
  { iso2: "SA", dial: "+966", name: "Saudi Arabia" },
  { iso2: "EG", dial: "+20", name: "Egypt" },
  { iso2: "ZA", dial: "+27", name: "South Africa" },
  { iso2: "NG", dial: "+234", name: "Nigeria" },
  { iso2: "KE", dial: "+254", name: "Kenya" },
  { iso2: "IN", dial: "+91", name: "India" },
  { iso2: "PK", dial: "+92", name: "Pakistan" },
  { iso2: "BD", dial: "+880", name: "Bangladesh" },
  { iso2: "CN", dial: "+86", name: "China" },
  { iso2: "JP", dial: "+81", name: "Japan" },
  { iso2: "KR", dial: "+82", name: "South Korea" },
  { iso2: "TW", dial: "+886", name: "Taiwan" },
  { iso2: "HK", dial: "+852", name: "Hong Kong" },
  { iso2: "SG", dial: "+65", name: "Singapore" },
  { iso2: "MY", dial: "+60", name: "Malaysia" },
  { iso2: "ID", dial: "+62", name: "Indonesia" },
  { iso2: "PH", dial: "+63", name: "Philippines" },
  { iso2: "TH", dial: "+66", name: "Thailand" },
  { iso2: "VN", dial: "+84", name: "Vietnam" },
  { iso2: "AU", dial: "+61", name: "Australia" },
  { iso2: "NZ", dial: "+64", name: "New Zealand" },
  { iso2: "MX", dial: "+52", name: "Mexico" },
  { iso2: "BR", dial: "+55", name: "Brazil" },
  { iso2: "AR", dial: "+54", name: "Argentina" },
  { iso2: "CL", dial: "+56", name: "Chile" },
  { iso2: "CO", dial: "+57", name: "Colombia" },
  { iso2: "PE", dial: "+51", name: "Peru" },
];
