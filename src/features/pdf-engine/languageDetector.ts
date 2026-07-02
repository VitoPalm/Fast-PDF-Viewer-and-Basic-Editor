/**
 * Lightweight Latin-language detector based on stop-word frequency analysis.
 *
 * Takes raw OCR text (from an English-only scan) and determines the most
 * likely secondary language by counting matches against curated lists of
 * high-frequency function words (articles, prepositions, conjunctions)
 * that are highly distinctive per language.
 */

interface LanguageProfile {
  code: string;       // Tesseract language code
  name: string;       // Human-readable name
  words: Set<string>; // Stop words (lowercase)
}

const PROFILES: LanguageProfile[] = [
  {
    code: 'ita',
    name: 'Italian',
    words: new Set([
      'il', 'lo', 'la', 'le', 'gli', 'uno', 'una', 'del', 'dello', 'della',
      'dei', 'degli', 'delle', 'dal', 'dalla', 'nel', 'nella', 'nei', 'nelle',
      'sul', 'sulla', 'con', 'per', 'tra', 'fra', 'che', 'chi', 'cui',
      'sono', 'hanno', 'anche', 'questo', 'questa', 'questi', 'queste',
      'molto', 'più', 'non', 'ma', 'se', 'quando', 'perché', 'dove', 'cosa',
      'come', 'può', 'ogni', 'tutto', 'tutti', 'essere', 'stato', 'altri',
      'aveva', 'fatto', 'dopo', 'ancora', 'quale', 'quali', 'già', 'loro',
      'sempre', 'stesso', 'quella', 'quello', 'quelle', 'quelli', 'quindi',
      'però', 'proprio', 'così', 'senza', 'oppure', 'alla', 'alle', 'agli',
    ]),
  },
  {
    code: 'fra',
    name: 'French',
    words: new Set([
      'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est',
      'en', 'que', 'qui', 'dans', 'ce', 'il', 'elle', 'ne', 'pas', 'sur',
      'pour', 'avec', 'au', 'aux', 'son', 'sa', 'ses', 'ont', 'sont',
      'été', 'fait', 'aussi', 'mais', 'ou', 'où', 'si', 'nous', 'vous',
      'ils', 'elles', 'leur', 'leurs', 'tout', 'cette', 'ces', 'mon', 'ton',
      'plus', 'bien', 'peut', 'comme', 'très', 'encore', 'autre', 'autres',
      'même', 'après', 'entre', 'avant', 'deux', 'sans', 'sous', 'chez',
      'donc', 'alors', 'puis', 'être', 'avoir', 'faire', 'était', 'quand',
    ]),
  },
  {
    code: 'spa',
    name: 'Spanish',
    words: new Set([
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del',
      'en', 'y', 'que', 'es', 'por', 'con', 'se', 'al', 'su', 'lo',
      'como', 'para', 'más', 'pero', 'fue', 'esta', 'son', 'todo', 'hay',
      'está', 'han', 'sin', 'sobre', 'también', 'muy', 'puede', 'entre',
      'desde', 'ya', 'nos', 'cuando', 'hasta', 'donde', 'otro', 'todos',
      'tiene', 'otro', 'otra', 'otros', 'estas', 'estos', 'ese', 'esa',
      'esos', 'aquí', 'después', 'antes', 'cada', 'porque', 'había',
      'ser', 'hacer', 'cual', 'sino', 'mismo', 'ella', 'ellos', 'hoy',
    ]),
  },
  {
    code: 'por',
    name: 'Portuguese',
    words: new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da',
      'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'por', 'com', 'que',
      'se', 'para', 'como', 'mais', 'mas', 'foi', 'são', 'está', 'tem',
      'não', 'também', 'muito', 'ou', 'já', 'seu', 'sua', 'ele', 'ela',
      'isso', 'este', 'essa', 'ao', 'aos', 'às', 'pelo', 'pela', 'entre',
      'sem', 'mesmo', 'ainda', 'quando', 'depois', 'sobre', 'todos',
      'essa', 'esse', 'esses', 'essas', 'aqui', 'então', 'pode', 'até',
      'ter', 'ser', 'fazer', 'havia', 'foram', 'outro', 'outra', 'outros',
    ]),
  },
  {
    code: 'deu',
    name: 'German',
    words: new Set([
      'der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'in', 'von', 'zu',
      'den', 'mit', 'auf', 'für', 'an', 'des', 'dem', 'nicht', 'sich',
      'aus', 'als', 'auch', 'es', 'wird', 'bei', 'nach', 'durch', 'über',
      'am', 'oder', 'aber', 'wie', 'hat', 'sind', 'war', 'noch', 'so',
      'kann', 'nur', 'werden', 'sein', 'wenn', 'was', 'zum', 'zur', 'vor',
      'bis', 'um', 'vom', 'einem', 'einer', 'eines', 'diese', 'dieser',
      'dieses', 'haben', 'wird', 'wurde', 'werden', 'können', 'müssen',
      'mehr', 'schon', 'sehr', 'hier', 'alle', 'dann', 'immer', 'jetzt',
    ]),
  },
  {
    code: 'ron',
    name: 'Romanian',
    words: new Set([
      'și', 'în', 'de', 'la', 'cu', 'pe', 'un', 'o', 'din', 'ce',
      'care', 'este', 'sunt', 'nu', 'pentru', 'mai', 'sau', 'dar', 'ca',
      'al', 'ale', 'lui', 'ei', 'lor', 'fost', 'acest', 'această',
      'după', 'prin', 'între', 'tot', 'toate', 'fără', 'avea', 'putea',
      'aici', 'acum', 'despre', 'doar', 'foarte', 'precum', 'dacă',
      'fie', 'iar', 'când', 'unde', 'astfel', 'asupra', 'către', 'până',
    ]),
  },
];

/** Minimum ratio of detected words to total tokens to be considered a match */
const MIN_CONFIDENCE = 0.03;

/** Minimum absolute word matches to avoid false positives on tiny samples */
const MIN_MATCHES = 5;

export interface DetectionResult {
  code: string;   // Tesseract language code (e.g. 'ita')
  name: string;   // Human-readable (e.g. 'Italian')
  confidence: number; // 0-1 ratio
}

/**
 * Detect the most likely secondary Latin language from OCR text.
 * Returns null if no language is detected with sufficient confidence,
 * meaning the document is likely English-only.
 */
export function detectLanguage(text: string): DetectionResult | null {
  // Tokenize: lowercase, split on non-alpha (keeping accented chars)
  const tokens = text
    .toLowerCase()
    .split(/[^a-zà-öø-ÿ]+/)
    .filter(w => w.length >= 1);

  if (tokens.length < 20) return null; // Too little text to detect

  let bestProfile: LanguageProfile | null = null;
  let bestScore = 0;
  let bestMatches = 0;

  for (const profile of PROFILES) {
    let matches = 0;
    for (const token of tokens) {
      if (profile.words.has(token)) matches++;
    }
    const score = matches / tokens.length;

    if (score > bestScore && matches >= MIN_MATCHES) {
      bestScore = score;
      bestProfile = profile;
      bestMatches = matches;
    }
  }

  if (!bestProfile || bestScore < MIN_CONFIDENCE) return null;

  console.log(
    `[LangDetect] Detected ${bestProfile.name} (${bestProfile.code}) ` +
    `with ${bestMatches}/${tokens.length} stop-word matches (${(bestScore * 100).toFixed(1)}%)`
  );

  return {
    code: bestProfile.code,
    name: bestProfile.name,
    confidence: bestScore,
  };
}
