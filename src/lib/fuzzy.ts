/** Lowercase, accents stripped: "Vérification" and "verification" are one word. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** One word against the text: a substring wins, letters in order still count. */
function wordScore(word: string, text: string): number | null {
  const at = text.indexOf(word);
  if (at !== -1) {
    // Starting a word ("lock" in "auto-lock") beats sitting inside one.
    const starts = at === 0 || !/[a-z0-9]/.test(text[at - 1]);
    return 100 + word.length * 10 + (starts ? 50 : 0);
  }
  let score = 0;
  let from = 0;
  for (const ch of word) {
    const i = text.indexOf(ch, from);
    if (i === -1) return null;
    // Adjacent letters are worth more than ones spread across the text.
    score += i === from ? 5 : 1;
    from = i + 1;
  }
  return score;
}

/**
 * How well `query` matches `text`, or null for no match; higher is better.
 * Every word of the query has to match somewhere, as a substring or as its
 * letters in order ("atlk" finds "Auto-lock"). An empty query matches all.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const haystack = fold(text);
  let total = 0;
  for (const word of words) {
    const s = wordScore(word, haystack);
    if (s === null) return null;
    total += s;
  }
  return total;
}
