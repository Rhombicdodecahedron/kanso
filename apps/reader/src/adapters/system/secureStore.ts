import * as SecureStore from 'expo-secure-store';

import type { SecretStore } from '@kanso/core';

/** The iOS keychain. */
export const keychain: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => (value === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value)),
};
