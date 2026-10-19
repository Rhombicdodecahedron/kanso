'use client';

// Screens that take their id from the query string (static routes: ids exist only in this browser).

import { useSearchParams } from 'next/navigation';

import { ErrorState } from '@/ui/components/States';
import { MangaScreen } from '@/ui/screens/MangaScreen';
import { ReaderScreen } from '@/ui/screens/ReaderScreen';
import { SourceScreen } from '@/ui/screens/SourceScreen';
import { SourceSettingsScreen } from '@/ui/screens/SourceSettingsScreen';

function useParam(name: string): string | null {
  return useSearchParams().get(name);
}

const Missing = () => <ErrorState message="This link is missing what it points to." />;

export function SourceRoute() {
  const id = useParam('id');
  return id ? <SourceScreen key={id} id={id} /> : <Missing />;
}

export function SourceSettingsRoute() {
  const id = useParam('id');
  return id ? <SourceSettingsScreen key={id} id={id} /> : <Missing />;
}

export function MangaRoute() {
  const id = Number(useParam('id'));
  return id ? <MangaScreen key={id} id={id} /> : <Missing />;
}

export function ReaderRoute() {
  // Keyed on nothing: the reader moves the URL along as chapters follow each other.
  const id = Number(useParam('chapter'));
  return id ? <ReaderScreen chapterId={id} /> : <Missing />;
}
