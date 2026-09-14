export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "other";

// Standard BIN-prefix ranges; detection only needs the first 6 digits.
export function cardBrand(numberOrBin: string | null | undefined): CardBrand {
  const digits = (numberOrBin ?? "").replace(/\D/g, "");
  if (!digits) return "other";
  const two = parseInt(digits.slice(0, 2), 10);
  const four = parseInt(digits.slice(0, 4), 10);
  if (digits[0] === "4") return "visa";
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return "mastercard";
  if (two === 34 || two === 37) return "amex";
  if (digits.startsWith("6011") || digits.startsWith("65") || (two >= 64 && two <= 65)) return "discover";
  return "other";
}
