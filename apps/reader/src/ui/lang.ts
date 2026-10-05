const OVERRIDES: Record<string, string> = { all: 'Multi', other: 'Other', 'es-419': 'Español (Latinoamérica)', 'pt-BR': 'Português (Brasil)', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' };

/** Language code -> its own name ("fr" -> "Français"). */
export function languageName(code: string): string {
  if (OVERRIDES[code]) return OVERRIDES[code];
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
  } catch {
    // unknown code or no Intl.DisplayNames
  }
  return code.toUpperCase();
}
