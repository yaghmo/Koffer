export interface Country {
  iso2: string;
  dial: string;
  name: string;
  /** Digit grouping for the national number; falls back to groups of three. */
  groups?: number[];
  /** Italy is the notable country that keeps its leading 0 when dialed internationally. */
  keepTrunkZero?: boolean;
  /**
   * Longest national number, without the trunk 0. Left out where lengths
   * vary a lot (Germany, Austria, Italy...); E.164's 15 digits apply there.
   */
  maxDigits?: number;
}

/**
 * The same countries in alphabetical order, for pickers. COUNTRIES itself
 * stays in its curated order because its first entry is the +1 default.
 */
export const COUNTRIES_BY_NAME = (): Country[] =>
  [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));

/** Most digits a national number under this dial code can have. */
export function maxDigitsForDial(dial: string): number {
  const known = COUNTRIES.find((c) => c.dial === dial && c.maxDigits)?.maxDigits;
  return known ?? 15 - dial.replace(/\D/g, "").length;
}

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
  { iso2: "US", dial: "+1", name: "United States", groups: [3, 3, 4], maxDigits: 10 },
  { iso2: "CA", dial: "+1", name: "Canada", groups: [3, 3, 4], maxDigits: 10 },
  { iso2: "GB", dial: "+44", name: "United Kingdom", maxDigits: 10 },
  { iso2: "IE", dial: "+353", name: "Ireland", maxDigits: 9 },
  { iso2: "FR", dial: "+33", name: "France", groups: [1, 2, 2, 2, 2], maxDigits: 9 },
  { iso2: "DE", dial: "+49", name: "Germany" },
  { iso2: "ES", dial: "+34", name: "Spain", maxDigits: 9 },
  { iso2: "PT", dial: "+351", name: "Portugal", maxDigits: 9 },
  { iso2: "IT", dial: "+39", name: "Italy", keepTrunkZero: true },
  { iso2: "NL", dial: "+31", name: "Netherlands", maxDigits: 9 },
  { iso2: "BE", dial: "+32", name: "Belgium", maxDigits: 9 },
  { iso2: "CH", dial: "+41", name: "Switzerland", maxDigits: 9 },
  { iso2: "AT", dial: "+43", name: "Austria" },
  { iso2: "SE", dial: "+46", name: "Sweden" },
  { iso2: "NO", dial: "+47", name: "Norway", maxDigits: 8 },
  { iso2: "DK", dial: "+45", name: "Denmark", maxDigits: 8 },
  { iso2: "FI", dial: "+358", name: "Finland" },
  { iso2: "PL", dial: "+48", name: "Poland", maxDigits: 9 },
  { iso2: "CZ", dial: "+420", name: "Czechia", maxDigits: 9 },
  { iso2: "GR", dial: "+30", name: "Greece", maxDigits: 10 },
  { iso2: "RO", dial: "+40", name: "Romania", maxDigits: 9 },
  { iso2: "HU", dial: "+36", name: "Hungary", maxDigits: 9 },
  { iso2: "UA", dial: "+380", name: "Ukraine", maxDigits: 9 },
  { iso2: "RU", dial: "+7", name: "Russia", maxDigits: 10 },
  { iso2: "TR", dial: "+90", name: "Turkey", maxDigits: 10 },
  { iso2: "IL", dial: "+972", name: "Israel", maxDigits: 9 },
  { iso2: "AE", dial: "+971", name: "United Arab Emirates", maxDigits: 9 },
  { iso2: "SA", dial: "+966", name: "Saudi Arabia", maxDigits: 9 },
  { iso2: "EG", dial: "+20", name: "Egypt", maxDigits: 10 },
  { iso2: "ZA", dial: "+27", name: "South Africa", maxDigits: 9 },
  { iso2: "NG", dial: "+234", name: "Nigeria", maxDigits: 10 },
  { iso2: "KE", dial: "+254", name: "Kenya", maxDigits: 9 },
  { iso2: "IN", dial: "+91", name: "India", maxDigits: 10 },
  { iso2: "PK", dial: "+92", name: "Pakistan", maxDigits: 10 },
  { iso2: "BD", dial: "+880", name: "Bangladesh", maxDigits: 10 },
  { iso2: "CN", dial: "+86", name: "China", maxDigits: 11 },
  { iso2: "JP", dial: "+81", name: "Japan", maxDigits: 10 },
  { iso2: "KR", dial: "+82", name: "South Korea", maxDigits: 10 },
  { iso2: "TW", dial: "+886", name: "Taiwan", maxDigits: 9 },
  { iso2: "HK", dial: "+852", name: "Hong Kong", maxDigits: 8 },
  { iso2: "SG", dial: "+65", name: "Singapore", maxDigits: 8 },
  { iso2: "MY", dial: "+60", name: "Malaysia", maxDigits: 10 },
  { iso2: "ID", dial: "+62", name: "Indonesia", maxDigits: 12 },
  { iso2: "PH", dial: "+63", name: "Philippines", maxDigits: 10 },
  { iso2: "TH", dial: "+66", name: "Thailand", maxDigits: 9 },
  { iso2: "VN", dial: "+84", name: "Vietnam", maxDigits: 10 },
  { iso2: "AU", dial: "+61", name: "Australia", maxDigits: 9 },
  { iso2: "NZ", dial: "+64", name: "New Zealand", maxDigits: 10 },
  { iso2: "MX", dial: "+52", name: "Mexico", maxDigits: 10 },
  { iso2: "BR", dial: "+55", name: "Brazil", maxDigits: 11 },
  { iso2: "AR", dial: "+54", name: "Argentina", maxDigits: 11 },
  { iso2: "CL", dial: "+56", name: "Chile", maxDigits: 9 },
  { iso2: "CO", dial: "+57", name: "Colombia", maxDigits: 10 },
  { iso2: "PE", dial: "+51", name: "Peru", maxDigits: 9 },
];
