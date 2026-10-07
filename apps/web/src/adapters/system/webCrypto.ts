import type { Crypto } from '@kanso/core';

export const webCrypto: Crypto = {
  async sha256(text) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
  randomId: () => crypto.randomUUID(),
};
