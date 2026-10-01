import { NextRequest, NextResponse } from 'next/server';
import { parseD } from '@/lib/stats';
import {
  MODEL_LABELS,
  MODEL_VERSIONS,
  type ForecastEntry,
  type ForecastModel,
} from '@/lib/forecast';
import { isReadonlyStore, readLog, writeLog, STORE_READONLY } from '@/lib/forecastStore';
import { reconcileOne } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';

function byNewest(a: ForecastEntry, b: ForecastEntry): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** GET /api/forecast — toàn bộ nhật ký mô phỏng (mới nhất trước). */
export async function GET() {
  const entries = await readLog();
  entries.sort(byNewest);
  return NextResponse.json({ entries, readonly: isReadonlyStore() });
}

function isModel(v: unknown): v is ForecastModel {
  return v === 'mlp' || v === 'freq';
}

function isNumStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{2}$/.test(v);
}

/**
 * POST /api/forecast — ghi một mô phỏng vào nhật ký (snapshot TRƯỚC outcome).
 * Body: { targetDate, model, k, numbers[], params, dataRange, note? }
 * Thiếu GITHUB_TOKEN trên production → 501 (UI lưu tạm localStorage).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON không hợp lệ.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const targetDate = typeof b.targetDate === 'string' ? b.targetDate : '';
  const model = b.model;
  const k = typeof b.k === 'number' ? Math.floor(b.k) : 0;
  const numbers = Array.isArray(b.numbers) ? b.numbers : [];

  if (!parseD(targetDate)) {
    return NextResponse.json({ error: 'targetDate phải dạng DD-MM-YYYY.' }, { status: 400 });
  }
  if (!isModel(model)) {
    return NextResponse.json({ error: 'model phải là mlp hoặc freq.' }, { status: 400 });
  }
  if (!(k >= 1 && k <= 30) || numbers.length !== k || !numbers.every(isNumStr)) {
    return NextResponse.json(
      { error: 'numbers phải là mảng k số phân biệt dạng "00".."99".' },
      { status: 400 },
    );
  }
  if (new Set(numbers).size !== numbers.length) {
    return NextResponse.json({ error: 'numbers không được trùng.' }, { status: 400 });
  }

  const entry: ForecastEntry = {
    id: `fc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    createdAt: new Date().toISOString(),
    targetDate,
    model,
    modelVersion: MODEL_VERSIONS[model],
    mode: 'shadow',
    k,
    params: {
      lookback: Number((b.params as Record<string, unknown> | undefined)?.lookback) || 10,
      hidden: Number((b.params as Record<string, unknown> | undefined)?.hidden) || 64,
      epochs: Number((b.params as Record<string, unknown> | undefined)?.epochs) || 500,
      lr: Number((b.params as Record<string, unknown> | undefined)?.lr) || 0.5,
      seed: Number((b.params as Record<string, unknown> | undefined)?.seed) || 42,
    },
    dataRange: (b.dataRange as ForecastEntry['dataRange']) ?? {
      from: '',
      to: '',
      days: 0,
      live: 0,
      seed: 0,
    },
    numbers: numbers as string[],
    status: 'pending',
    note: typeof b.note === 'string' ? b.note.slice(0, 500) : undefined,
  };

  try {
    const log = await readLog();
    log.push(entry);
    await writeLog(log);
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === STORE_READONLY || (e as Error).message === STORE_READONLY) {
      return NextResponse.json(
        {
          error:
            'Nhật ký chung chưa ghi được: thiếu GITHUB_TOKEN trên server. ' +
            'Hãy lưu tạm trên trình duyệt và thêm token theo README.',
          code: STORE_READONLY,
          entry,
        },
        { status: 501 },
      );
    }
    return NextResponse.json({ error: 'Không ghi được nhật ký.' }, { status: 500 });
  }
  return NextResponse.json({ entry }, { status: 201 });
}

/**
 * PATCH /api/forecast — đối chiếu thủ công một entry: { id, action: 'reconcile' }.
 * Chỉ đối chiếu khi đã có số liệu LIVE của ngày mục tiêu.
 */
export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON không hợp lệ.' }, { status: 400 });
  }
  const { id, action } = body as { id?: unknown; action?: unknown };
  if (typeof id !== 'string' || action !== 'reconcile') {
    return NextResponse.json({ error: 'Cần { id, action: "reconcile" }.' }, { status: 400 });
  }
  const log = await readLog();
  const idx = log.findIndex((e) => e.id === id);
  if (idx < 0) return NextResponse.json({ error: 'Không tìm thấy entry.' }, { status: 404 });

  const updated = await reconcileOne(log[idx]);
  if (!updated) {
    return NextResponse.json(
      {
        reconciled: false,
        reason: 'Chưa có số liệu thật của ngày mục tiêu (hoặc entry đã đối chiếu).',
      },
      { status: 200 },
    );
  }
  log[idx] = updated;
  try {
    await writeLog(log);
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === STORE_READONLY || (e as Error).message === STORE_READONLY) {
      return NextResponse.json(
        { error: 'Không ghi được nhật ký chung (thiếu GITHUB_TOKEN).', code: STORE_READONLY },
        { status: 501 },
      );
    }
    return NextResponse.json({ error: 'Không ghi được nhật ký.' }, { status: 500 });
  }
  return NextResponse.json({
    reconciled: true,
    entry: updated,
    modelLabel: MODEL_LABELS[updated.model],
  });
}
