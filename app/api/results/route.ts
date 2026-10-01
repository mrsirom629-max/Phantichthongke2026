import { NextRequest, NextResponse } from 'next/server';
import { fetchDay } from '@/lib/minhngoc';
import { parseD, todayVN } from '@/lib/stats';
import type { DayResult } from '@/lib/types';
import seedJson from '@/data/seed.json';

export const dynamic = 'force-dynamic';

type Source = 'minhngoc' | 'seed';

interface SeedFile {
  meta: { source: string; note: string; generatedAt: string };
  days: DayResult[];
}

/**
 * GET /api/results?date=DD-MM-YYYY
 * - date mặc định: hôm nay (giờ VN).
 * - Thử lấy live từ minhngoc.net.vn; nếu null (chưa có KQ / lỗi mạng / parse lỗi)
 *   thì fallback sang data/seed.json.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('date');
  const date = raw && parseD(raw) ? raw : todayVN();

  let data: DayResult | null = null;
  try {
    data = await fetchDay(date);
  } catch {
    data = null;
  }

  let source: Source = 'minhngoc';
  let note: string | undefined;
  if (!data) {
    source = 'seed';
    const seed = seedJson as unknown as SeedFile;
    data = seed.days.find((d) => d.date === date) ?? null;
    note = 'Dữ liệu mẫu demo offline — không phải kết quả quay số thật';
  }

  return NextResponse.json({
    source,
    data,
    ...(note ? { note } : {}),
  });
}
