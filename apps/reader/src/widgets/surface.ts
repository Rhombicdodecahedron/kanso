import type { ContinueReadingSurface, SourceGateway, UseCases } from '@kanso/core';

import { syncWidget } from './sync';

/** The iOS "Continue reading" widget as a ContinueReadingSurface. */
export function createWidgetSurface(uc: UseCases, sources: SourceGateway): ContinueReadingSurface {
  return {
    refresh: () => syncWidget(uc, sources),
    seen: (s) => syncWidget(uc, sources, s),
  };
}
