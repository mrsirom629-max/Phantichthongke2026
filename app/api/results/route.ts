import { NextRequest, NextResponse } from 'next/server';
import { fetchDayDetailed } from '@/lib/minhngoc';
import { parseD, todayVN } from '@/lib/stats';
import type { DayResult, Mien } from '@/lib/types';
import seedJson from '@/data/seed.json';

export const dynamic = 'force-dynamic';

type Source = 'minhngoc' | 'seed';

interface SeedFile {
  meta: { source: string; note: string; generatedAt: string };
  days: DayResult[];
}

/**
 * GET /api/results?date=DD-MM-YYYY&mien=nam|bac
 * - date mặc định: hôm nay (giờ VN). mien mặc định: nam.
 * - Thử lấy live từ minhngoc.net.vn; nếu thất bại (lỗi mạng / HTTP / parse)
 *   thì fallback sang data/seed.json (lọc theo miền) và ghi rõ lý do trong `note`.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('date');
  const date = raw && parseD(raw) ? raw : todayVN();
  const mienParam = req.nextUrl.searchParams.get('mien');
  const mien: Mien = mienParam === 'bac' ? 'bac' : 'nam';

  const detail = await fetchDayDetailed(date, mien);

  let source: Source = 'minhngoc';
  let data = detail.data;
  let note: string | undefined;
  if (!data) {
    source = 'seed';
    const seed = seedJson as unknown as SeedFile;
    data = seed.days.find((d) => d.date === date && d.mien === mien) ?? null;
    const reason =
      detail.stage === 'http-error'
        ? `máy chủ nguồn trả lỗi HTTP ${detail.httpStatus ?? ''}`.trim()
        : detail.stage === 'fetch-error'
          ? 'không kết nối được máy chủ nguồn'
          : 'không đọc được cấu trúc trang nguồn';
    note = `Dữ liệu mẫu demo offline — không phải kết quả quay số thật (${reason}).`;
  }

  return NextResponse.json({
    source,
    data,
    ...(note ? { note } : {}),
  });
}
