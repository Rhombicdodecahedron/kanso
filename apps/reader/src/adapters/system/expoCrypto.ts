import * as ExpoCrypto from 'expo-crypto';

import type { Crypto } from '@kanso/core';

export const expoCrypto: Crypto = {
  sha256: (text) => ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, text),
  randomId: () => ExpoCrypto.randomUUID(),
};
