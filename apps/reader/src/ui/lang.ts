const OVERRIDES: Record<string, string> = { all: 'Multi', other: 'Other', 'es-419': 'Español (Latinoamérica)', 'pt-BR': 'Português (Brasil)', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' };

// Hermes has no Intl.DisplayNames: native names for the languages extensions use.
const NAMES: Record<string, string> = {
  en: 'English', fr: 'Français', es: 'Español', pt: 'Português', de: 'Deutsch', it: 'Italiano', id: 'Bahasa Indonesia',
  ja: '日本語', ko: '한국어', zh: '中文', ru: 'Русский', tr: 'Türkçe', ar: 'العربية', th: 'ไทย', vi: 'Tiếng Việt', pl: 'Polski',
  uk: 'Українська', nl: 'Nederlands', cs: 'Čeština', hu: 'Magyar', ro: 'Română', bg: 'Български', ca: 'Català', fil: 'Filipino',
  hi: 'हिन्दी', bn: 'বাংলা', fa: 'فارسی', he: 'עברית', ms: 'Bahasa Melayu', sv: 'Svenska', el: 'Ελληνικά', my: 'မြန်မာ',
};

/** Language code -> its own name ("fr" -> "Français"). */
export function languageName(code: string): string {
  if (OVERRIDES[code]) return OVERRIDES[code];
  if (NAMES[code]) return NAMES[code];
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
  } catch {
    // unknown code or no Intl.DisplayNames
  }
  return code.toUpperCase();
}
