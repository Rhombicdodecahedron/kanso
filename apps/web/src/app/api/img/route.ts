import { image } from '@/server/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = (req: Request) => image(req);
