// Web APIs the runtime relies on that Hermes may not provide. Installed only when missing.

import { utf8Bytes, utf8String } from './java/charset';

const WIN1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030,
  0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178,
};

function norm(label: string): string {
  const l = label.trim().toLowerCase();
  if (l === 'utf8' || l === 'unicode-1-1-utf-8') return 'utf-8';
  if (['latin1', 'iso-8859-1', 'iso8859-1', 'l1', 'ascii', 'us-ascii'].includes(l)) return 'windows-1252';
  if (l === 'utf-16' || l === 'utf-16le') return 'utf-16le';
  return l;
}

class TextDecoderPolyfill {
  readonly encoding: string;
  readonly fatal: boolean;
  constructor(label = 'utf-8', opts: { fatal?: boolean } = {}) {
    this.encoding = norm(label);
    this.fatal = !!opts.fatal;
    if (!['utf-8', 'windows-1252', 'utf-16le', 'utf-16be'].includes(this.encoding)) throw new RangeError(`Unsupported encoding: ${label}`);
  }
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return '';
    const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    switch (this.encoding) {
      case 'utf-8': {
        let start = 0;
        if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) start = 3;
        const s = utf8String(b, start);
        if (this.fatal && s.includes('�') && !hasReplacementBytes(b)) throw new TypeError('The encoded data was not valid utf-8');
        return s;
      }
      case 'windows-1252': {
        let out = '';
        for (let i = 0; i < b.length; i += 4096) {
          const part = Array.from(b.subarray(i, i + 4096), (x) => WIN1252[x] ?? x);
          out += String.fromCharCode.apply(null, part);
        }
        return out;
      }
      default: {
        const le = this.encoding === 'utf-16le';
        let out = '';
        for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
        return out;
      }
    }
  }
}

function hasReplacementBytes(b: Uint8Array): boolean {
  for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0xef && b[i + 1] === 0xbf && b[i + 2] === 0xbd) return true;
  return false;
}

class TextEncoderPolyfill {
  readonly encoding = 'utf-8';
  encode(s = ''): Uint8Array {
    return utf8Bytes(s);
  }
}

export function installPolyfills(): void {
  const g = globalThis as any;
  if (typeof g.TextDecoder !== 'function') g.TextDecoder = TextDecoderPolyfill;
  else {
    // Hermes' TextDecoder (if any) may only know UTF-8: fall back for other labels.
    try {
      new g.TextDecoder('latin1');
    } catch {
      const Native = g.TextDecoder;
      g.TextDecoder = function (label?: string, opts?: any) {
        try {
          return new Native(label, opts);
        } catch {
          return new TextDecoderPolyfill(label, opts);
        }
      };
    }
  }
  if (typeof g.TextEncoder !== 'function') g.TextEncoder = TextEncoderPolyfill;
}

installPolyfills();

export { TextDecoderPolyfill };
