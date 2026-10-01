import { NextRequest, NextResponse } from 'next/server';
import { readLog, writeLog, isReadonlyStore } from '@/lib/forecastStore';
import { reconcileOne } from '@/lib/reconcile';
import { fmtPct } from '@/lib/forecast';

export const dynamic = 'force-dynamic';
// Cron chạy 1 lần/ngày lúc 17h30 (giờ VN) — cho phép chạy lâu hơn mặc định.
export const maxDuration = 60;

/**
 * GET /api/reconcile — job đối chiếu hàng ngày (Vercel Cron 17:30 Asia/Ho_Chi_Minh).
 * Duyệt mọi entry pending có targetDate <= hôm nay, đối chiếu với số liệu LIVE,
 * ghi metrics vào nhật ký. Bỏ qua khi chưa có số thật (giữ pending).
 *
 * Bảo vệ: nếu đặt CRON_SECRET, Vercel Cron tự gửi Authorization: Bearer <secret>.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (isReadonlyStore()) {
    return NextResponse.json(
      { error: 'Store chỉ đọc (thiếu GITHUB_TOKEN) — không ghi được nhật ký.' },
      { status: 501 },
    );
  }

  const log = await readLog();
  let reconciled = 0;
  let skipped = 0;
  const details: { id: string; targetDate: string; precision: string }[] = [];

  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.status !== 'pending') continue;
    try {
      const updated = await reconcileOne(e);
      if (updated) {
        log[i] = updated;
        reconciled++;
        details.push({
          id: updated.id,
          targetDate: updated.targetDate,
          precision: fmtPct(updated.metrics?.precision ?? 0),
        });
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  if (reconciled > 0) {
    await writeLog(log);
  }

  return NextResponse.json({
    ok: true,
    reconciled,
    skipped,
    total: log.length,
    details,
    at: new Date().toISOString(),
  });
}
