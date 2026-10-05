import { planChapterSync, recognizeChapterNumber } from './chapters';
import type { Chapter, RemoteChapter } from './model';

const rc = (url: string, name: string, n = -1): RemoteChapter => ({ url, name, date_upload: 1000, chapter_number: n, scanlator: null });
const ch = (id: number, url: string, n: number, extra: Partial<Chapter> = {}): Chapter => ({
  id,
  mangaId: 1,
  url,
  name: `Chapter ${n}`,
  scanlator: null,
  chapterNumber: n,
  dateUpload: 1000,
  dateFetch: 0,
  sourceOrder: 0,
  read: false,
  bookmark: false,
  lastPageRead: 0,
  pageOffset: 0,
  memo: null,
  ...extra,
});

describe('recognizeChapterNumber', () => {
  it.each([
    ['Chapter 12', 12],
    ['Ch. 12.5 - The end', 12.5],
    ['Vol.3 Chapter 4', 4],
    ['Episode 7', 7],
    ['第10話', 10],
    ['One Piece 1100', 1100],
    ['Prologue', -1],
  ])('%s -> %s', (name, n) => {
    expect(recognizeChapterNumber('One Piece', name)).toBe(n);
  });
});

describe('planChapterSync', () => {
  it('inserts new chapters in source order and recognises numbers', () => {
    const plan = planChapterSync(1, 'T', [], [rc('/c2', 'Chapter 2'), rc('/c1', 'Chapter 1')], 100);
    expect(plan.insert.map((c) => [c.url, c.chapterNumber, c.sourceOrder, c.dateFetch])).toEqual([
      ['/c2', 2, 0, 100],
      ['/c1', 1, 1, 99],
    ]);
  });

  it('updates changed chapters but keeps reading state', () => {
    const plan = planChapterSync(1, 'T', [ch(5, '/c1', 1, { read: true, lastPageRead: 3 })], [rc('/c1', 'Chapter 1 (fixed)', 1)], 100);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: 5, name: 'Chapter 1 (fixed)', read: true, lastPageRead: 3 });
  });

  it('removes chapters gone from the source and carries state to re-uploads', () => {
    const plan = planChapterSync(1, 'T', [ch(5, '/old-c1', 1, { read: true })], [rc('/new-c1', 'Chapter 1', 1)], 100);
    expect(plan.remove).toEqual([5]);
    expect(plan.insert[0]).toMatchObject({ url: '/new-c1', read: true });
  });

  it('ignores duplicate URLs from the source', () => {
    const plan = planChapterSync(1, 'T', [], [rc('/a', 'Chapter 1'), rc('/a', 'Chapter 1 dup')], 100);
    expect(plan.insert).toHaveLength(1);
  });
});
