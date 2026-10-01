import { NextRequest, NextResponse } from 'next/server';
import { readLog, writeLog, isReadonlyStore } from '@/lib/forecastStore';
import { reconcileOne } from '@/lib/reconcile';
import { fmtPct } from '@/lib/forecast';

export const dynamic = 'force-dynamic';
// Cron đối chiếu 1 lần/ngày lúc 18:35 giờ VN (sau giờ quay cả 2 miền:
// XSMN ~16:15–16:35, XSMB ~18:15–18:30) — giới hạn gói Hobby của Vercel
// chỉ cho phép cron chạy 1 lần/ngày.
// Đọc trang TRỰC TIẾP trước (sớm nhất), rồi tới trang lưu trữ theo ngày.
// Chỉ đối chiếu khi đủ 100% số liệu; thiếu thì giữ pending.
// Muốn đối chiếu sớm hơn trong ngày: bấm "Đối chiếu ngay" trên trang Dự báo.
export const maxDuration = 60;

/**
 * GET /api/reconcile — job đối chiếu (Vercel Cron).
 * Duyệt mọi entry pending có targetDate <= hôm nay, đối chiếu với số liệu LIVE
 * (ưu tiên trang trực tiếp khi là ngày hôm nay), ghi metrics vào nhật ký.
 * Bỏ qua khi chưa có số thật (giữ pending).
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
