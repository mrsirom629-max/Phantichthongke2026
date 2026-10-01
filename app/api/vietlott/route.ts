import { NextRequest, NextResponse } from 'next/server';
import { fetchPowerPage, type PowerDraw } from '@/lib/vietlott';
import { isValidDate } from '@/lib/stats';
import seedFile from '@/data/seed-power655.json';

export const dynamic = 'force-dynamic';

const SEED = (seedFile as { draws: PowerDraw[] }).draws ?? [];
const key = (s: string) => s.split('-').reverse().join('');

/**
 * GET /api/vietlott?date=DD-MM-YYYY
 * Trả về các kỳ Power 6/55 trong trang ngày đó (~10 kỳ gần nhất tính đến ngày đó).
 * Live từ Minh Ngọc trước; lỗi mạng/trang trống -> fallback seed (ghi rõ nguồn).
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? '';
  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date phải dạng DD-MM-YYYY.' }, { status: 400 });
  }
  const r = await fetchPowerPage(date);
  if (r.stage === 'ok') {
    return NextResponse.json({ source: 'minhngoc', draws: r.draws });
  }
  // Fallback seed: 10 kỳ mẫu gần nhất tính đến ngày yêu cầu
  const draws = SEED.filter((d) => key(d.date) <= key(date)).slice(0, 10);
  return NextResponse.json({ source: 'seed', draws });
}
