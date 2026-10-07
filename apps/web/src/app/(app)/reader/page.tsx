import { Suspense } from 'react';

import { ReaderRoute } from '@/ui/routes';

export default function Page() {
  return (
    <Suspense>
      <ReaderRoute />
    </Suspense>
  );
}
