// Source-level rewrites for Kotlin syntax the tree-sitter grammar does not support yet.

/**
 * Kotlin 2.2 multi-dollar strings: in `$$"""..."""` a single `$` is literal and `$$x` / `$${e}`
 * interpolate. Rewrite to a classic raw string where literal `$` becomes `${'$'}`.
 */
export function rewriteMultiDollar(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const m = /\$(\$+)("""|")/y;
    m.lastIndex = i;
    const hit = m.exec(src);
    if (!hit || (i > 0 && /[\w$]/.test(src[i - 1]))) {
      out += src[i++];
      continue;
    }
    const dollars = hit[1].length + 1;
    const quote = hit[2];
    let j = i + hit[0].length;
    let body = '';
    const interp = '$'.repeat(dollars);
    while (j < src.length && !src.startsWith(quote, j)) {
      if (src.startsWith(interp, j) && (src[j + dollars] === '{' || /[A-Za-z_]/.test(src[j + dollars] ?? ''))) {
        body += '$';
        j += dollars;
        if (src[j] === '{') {
          // copy balanced braces
          let depth = 0;
          do {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            body += src[j++];
          } while (depth > 0 && j < src.length);
        }
        continue;
      }
      if (src[j] === '$') {
        body += "${'$'}";
        j++;
        continue;
      }
      body += src[j++];
    }
    out += quote + body + quote;
    i = j + quote.length;
  }
  return out;
}

/** `List<@Serializable(X::class) T>` -> List<`T$ser$X`> (the translator maps it to a custom element serializer). */
export function rewriteAnnotatedTypeArgs(src: string): string {
  return src.replace(/([<,]\s*)@Serializable\(\s*(?:with\s*=\s*)?([\w.]+)::class\s*\)\s*([A-Z][\w.]*)/g, (_m, pre, ser, t) => `${pre}\`${t}$ser$${ser}\``);
}

/** `context(source: HttpSource)` -> `@KansoContext("source")` (implicit argument = the calling source). */
export function rewriteContextParams(src: string): string {
  return src.replace(/^(\s*)context\(\s*(\w+)\s*:\s*[\w.<>?, ]+\)\s*\n/gm, (_m, ind, name) => `${ind}@KansoContext("${name}")\n`);
}

export function preprocess(src: string): string {
  let s = src;
  if (s.includes('$$"')) s = rewriteMultiDollar(s);
  if (/[<,]\s*@Serializable\(/.test(s)) s = rewriteAnnotatedTypeArgs(s);
  if (/^\s*context\(/m.test(s)) s = rewriteContextParams(s);
  return s;
}
