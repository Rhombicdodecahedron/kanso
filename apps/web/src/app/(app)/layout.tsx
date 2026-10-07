import type { ReactNode } from 'react';

import { AppProvider } from '@/composition/AppProvider';
import { FeedbackProvider } from '@/ui/components/Feedback';
import { Shell } from '@/ui/components/Shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <FeedbackProvider>
        <Shell>{children}</Shell>
      </FeedbackProvider>
    </AppProvider>
  );
}
