import { Suspense } from 'react';

import { MangaRoute } from '@/ui/routes';

export default function Page() {
  return (
    <Suspense>
      <MangaRoute />
    </Suspense>
  );
}
