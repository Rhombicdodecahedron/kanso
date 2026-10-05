import { describe, expect, it } from 'vitest';
import { TextDecoderPolyfill } from '../src/polyfills';

describe('TextDecoder polyfill', () => {
  it('decodes utf-8, latin1 and utf-16le like the platform', () => {
    const utf8 = new TextEncoder().encode('héllo 漫画 😀');
    expect(new TextDecoderPolyfill('utf-8').decode(utf8)).toBe(new TextDecoder().decode(utf8));
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x80]);
    // WHATWG maps the latin1 label to windows-1252 (0x80 is the euro sign).
    expect(new TextDecoderPolyfill('latin1').decode(bytes)).toBe('café€');
    expect(new TextDecoderPolyfill('utf-16le').decode(Uint8Array.from([0x41, 0, 0x42, 0]))).toBe('AB');
    expect(() => new TextDecoderPolyfill('utf-8', { fatal: true }).decode(Uint8Array.from([0xff]))).toThrow();
  });
});
