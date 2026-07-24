// Shared search-normalization used by every content matcher (Movies/Series/Live
// across web, native, and TV). Folds the case *and* the many equivalent Arabic
// letterforms users type inconsistently, so a query matches regardless of
// diacritics, alef/hamza/taa-marbuta variants, tatweel, or digit script.
//
// Query and item text MUST go through the same function, or normalization on
// one side without the other silently breaks matching.

const TASHKEEL = /[ً-ْٰ]/g; // harakat, tanween, shadda, sukun, superscript alef
const TATWEEL = /ـ/g; // kashida elongation
const ALEF_VARIANTS = /[آأإٱ]/g; // آ أ إ ٱ → ا
const ALEF_MAKSURA = /ى/g; // ى → ي
const TAA_MARBUTA = /ة/g; // ة → ه
const HAMZA_WAW = /ؤ/g; // ؤ → و
const HAMZA_YAA = /ئ/g; // ئ → ي
const ARABIC_INDIC = /[٠-٩]/g; // ٠-٩ → 0-9
const EXTENDED_ARABIC_INDIC = /[۰-۹]/g; // ۰-۹ → 0-9

const foldDigits = (base) => (d) => String.fromCharCode(d.charCodeAt(0) - base + 48);

/**
 * Normalize a string for case- and Arabic-insensitive substring search.
 * Returns "" for nullish/empty input.
 */
export function normalizeSearch(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(ALEF_VARIANTS, "ا")
    .replace(ALEF_MAKSURA, "ي")
    .replace(TAA_MARBUTA, "ه")
    .replace(HAMZA_WAW, "و")
    .replace(HAMZA_YAA, "ي")
    .replace(ARABIC_INDIC, foldDigits(0x0660))
    .replace(EXTENDED_ARABIC_INDIC, foldDigits(0x06f0))
    .trim();
}
