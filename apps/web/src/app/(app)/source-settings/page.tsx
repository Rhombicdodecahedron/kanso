import { Suspense } from 'react';

import { SourceSettingsRoute } from '@/ui/routes';

export default function Page() {
  return (
    <Suspense>
      <SourceSettingsRoute />
    </Suspense>
  );
}
