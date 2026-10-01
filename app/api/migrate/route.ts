/**
 * POST /api/migrate — chuyển dữ liệu sang Upstash Redis.
 *
 * 2 chế độ:
 *  a) Không body: đọc từ backend GitHub (file trong repo) → ghi Redis.
 *  b) Có body { forecastLog?: [...], masterdata?: [...] }: ghi thẳng vào Redis.
 *     (Dùng khi GitHub API bị rate-limit, đẩy dữ liệu từ bản local đã đồng bộ.)
 *
 * Bảo vệ bằng CRON_SECRET (Authorization: Bearer <secret>).
 * Yêu cầu: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN đã cấu hình.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createForecastStore } from '@/lib/forecastStore';
import { createMasterdataStore } from '@/lib/masterdataStore';
import { mergeMasterdata, type StoredDay } from '@/lib/masterdata';
import type { ForecastEntry } from '@/lib/forecast';

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

  let body: { forecastLog?: unknown; masterdata?: unknown } | null = null;
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    /* không body hợp lệ → dùng chế độ đọc từ GitHub */
  }

  const report: Record<string, unknown> = {};

  // 1. forecast-log → redis
  try {
    const dst = createForecastStore('redis');
    if (body && Array.isArray(body.forecastLog)) {
      const entries = body.forecastLog as ForecastEntry[];
      await dst.write(entries);
      report['forecast-log'] = {
        migrated: entries.length,
        to: 'redis',
        via: 'direct-push',
      };
    } else {
      const src = createForecastStore('github');
      const entries = await src.read([]);
      if (entries.length > 0) {
        await dst.write(entries);
        report['forecast-log'] = { migrated: entries.length, to: 'redis', via: 'github' };
      } else {
        report['forecast-log'] = { migrated: 0, note: 'nguồn trống, không cần chuyển' };
      }
    }
  } catch (e) {
    report['forecast-log'] = { error: e instanceof Error ? e.message : 'lỗi không rõ' };
  }

  // 2. masterdata → redis (đi qua mergeMasterdata để đảm bảo không trùng, sắp xếp đúng)
  try {
    const dst = createMasterdataStore('nam', 'redis');
    if (body && Array.isArray(body.masterdata)) {
      const incoming = (body.masterdata as StoredDay[]).map((d) => ({
        date: d.date,
        source: d.source,
        day: d,
      }));
      const { days, report: rp } = mergeMasterdata([], incoming);
      await dst.write(days);
      report['masterdata'] = {
        migrated: rp.added,
        to: 'redis',
        via: 'direct-push',
      };
    } else {
      const src = createMasterdataStore('nam', 'github');
      const days = await src.read([]);
      if (days.length > 0) {
        await dst.write(days);
        report['masterdata'] = { migrated: days.length, to: 'redis', via: 'github' };
      } else {
        report['masterdata'] = { migrated: 0, note: 'nguồn trống, không cần chuyển' };
      }
    }
  } catch (e) {
    report['masterdata'] = { error: e instanceof Error ? e.message : 'lỗi không rõ' };
  }

  return NextResponse.json({ ok: true, report });
}
