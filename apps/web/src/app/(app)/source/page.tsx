import { Suspense } from 'react';

import { SourceRoute } from '@/ui/routes';

export default function Page() {
  return (
    <Suspense>
      <SourceRoute />
    </Suspense>
  );
}
