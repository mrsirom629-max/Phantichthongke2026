import { NextRequest, NextResponse } from 'next/server';
import { addDays, cmpDate, computeStats, drawsInRange, todayVN } from '@/lib/stats';
import type { DayResult } from '@/lib/types';
import seedJson from '@/data/seed.json';

export const dynamic = 'force-dynamic';

interface SeedFile {
  days: DayResult[];
}

/**
 * GET /api/stats?days=90&province=all
 * - Đọc từ data/seed.json (nhanh, không fetch live → tránh timeout serverless).
 * - province: "all" hoặc tên tỉnh / mã đài (ví dụ "Đồng Nai", "XSDN").
 *
 * GHI CHÚ CHẾ ĐỘ LIVE: khi cần thống kê trên dữ liệu thật, client tự gọi
 * GET /api/results?date=... cho từng ngày trong khoảng, gom thành DayResult[],
 * rồi aggregate bằng drawsInRange() + computeStats() từ lib/stats.ts
 * (engine thuần túy, chạy được cả client & server).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = parseInt(sp.get('days') ?? '90', 10);
  const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 365) : 90;
  const province = sp.get('province')?.trim() || 'all';

  const seed = seedJson as unknown as SeedFile;
  const all = [...seed.days].sort((a, b) => cmpDate(a.date, b.date));

  const lastDate = all.length > 0 ? all[all.length - 1].date : todayVN();
  const to = lastDate;
  const from = addDays(to, -(days - 1));

  const draws = drawsInRange(all, from, to, province);
  const stats = computeStats(draws, 10, province);

  return NextResponse.json({ source: 'seed', stats });
}
