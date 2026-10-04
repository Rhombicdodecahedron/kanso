// java.net.URLEncoder / java.net.URLDecoder (application/x-www-form-urlencoded, Java semantics).

import { IllegalArgumentException } from '../kotlin/core';
import { decodeBytes, encodeString, toCharset } from './charset';

const HEX = '0123456789ABCDEF';

function unreserved(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 46 || c === 45 || c === 42 || c === 95;
}

export class URLEncoder {
  /** encode(s), encode(s, "UTF-8") or encode(s, Charset) */
  static encode(s: string, enc?: any): string {
    const cs = toCharset(enc ?? 'UTF-8');
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (unreserved(c)) {
        out += s[i++];
        continue;
      }
      if (c === 32) {
        out += '+';
        i++;
        continue;
      }
      // Collect a run of characters needing encoding, then encode them together.
      let j = i;
      while (j < s.length) {
        const d = s.charCodeAt(j);
        if (unreserved(d) || d === 32) break;
        j++;
      }
      const bytes = encodeString(s.slice(i, j), cs);
      for (let k = 0; k < bytes.length; k++) out += '%' + HEX[bytes[k] >> 4] + HEX[bytes[k] & 15];
      i = j;
    }
    return out;
  }
}

export class URLDecoder {
  /** decode(s), decode(s, "UTF-8") or decode(s, Charset) */
  static decode(s: string, enc?: any): string {
    const cs = toCharset(enc ?? 'UTF-8');
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '+') {
        out += ' ';
        i++;
      } else if (c === '%') {
        const bytes: number[] = [];
        while (i + 2 < s.length + 0 && s[i] === '%') {
          const h = s.slice(i + 1, i + 3);
          if (!/^[0-9A-Fa-f]{2}$/.test(h)) throw new IllegalArgumentException(`URLDecoder: Illegal hex characters in escape (%) pattern - Error at index 0 in: "${h}"`);
          bytes.push(parseInt(h, 16));
          i += 3;
        }
        if (i < s.length && s[i] === '%') throw new IllegalArgumentException('URLDecoder: Incomplete trailing escape (%) pattern');
        out += decodeBytes(Uint8Array.from(bytes), cs);
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }
}
