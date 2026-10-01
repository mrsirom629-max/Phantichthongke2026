/**
 * POST /api/migrate — chuyển dữ liệu từ backend GitHub (file trong repo)
 * sang Upstash Redis, một lần duy nhất khi đổi kho lưu trữ.
 *
 * Bảo vệ bằng CRON_SECRET (Authorization: Bearer <secret>).
 * Yêu cầu: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN đã cấu hình.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createForecastStore } from '@/lib/forecastStore';
import { createMasterdataStore } from '@/lib/masterdataStore';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Chưa đặt CRON_SECRET nên không cho phép migrate.' },
      { status: 403 },
    );
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return NextResponse.json(
      { error: 'Chưa cấu hình Upstash Redis (thiếu UPSTASH_REDIS_REST_URL/TOKEN).' },
      { status: 501 },
    );
  }

  const report: Record<string, unknown> = {};

  // 1. forecast-log: github -> redis
  try {
    const src = createForecastStore('github');
    const dst = createForecastStore('redis');
    const entries = await src.read([]);
    if (entries.length > 0) {
      await dst.write(entries);
      report['forecast-log'] = { migrated: entries.length, to: 'redis' };
    } else {
      report['forecast-log'] = { migrated: 0, note: 'nguồn trống, không cần chuyển' };
    }
  } catch (e) {
    report['forecast-log'] = { error: e instanceof Error ? e.message : 'lỗi không rõ' };
  }

  // 2. masterdata: github -> redis
  try {
    const src = createMasterdataStore('github');
    const dst = createMasterdataStore('redis');
    const days = await src.read([]);
    if (days.length > 0) {
      await dst.write(days);
      report['masterdata'] = { migrated: days.length, to: 'redis' };
    } else {
      report['masterdata'] = { migrated: 0, note: 'nguồn trống, không cần chuyển' };
    }
  } catch (e) {
    report['masterdata'] = { error: e instanceof Error ? e.message : 'lỗi không rõ' };
  }

  return NextResponse.json({ ok: true, report });
}
