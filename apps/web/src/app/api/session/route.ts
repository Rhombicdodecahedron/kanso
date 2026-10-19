import { session } from '@/server/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: Request) => session.POST(req);
export const GET = (req: Request) => session.GET(req);
export const DELETE = () => session.DELETE();
