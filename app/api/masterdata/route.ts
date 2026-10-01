/**
 * API masterdata — kho ngày đã tải, bền vững.
 * GET  → { days, count, from, to, readonly }
 * POST → { days: [{ date, source, day }] } → gộp không trùng (thêm mới / nâng cấp seed→live)
 */
import { NextRequest, NextResponse } from 'next/server';
import { isReadonlyError } from '@/lib/jsonStore';
import { createMasterdataStore } from '@/lib/masterdataStore';
import { mergeMasterdata, type IncomingDay } from '@/lib/masterdata';
import { isValidDate } from '@/lib/stats';

export const dynamic = 'force-dynamic';

const store = createMasterdataStore();

export async function GET() {
  const days = await store.read([]);
  return NextResponse.json({
    days,
    count: days.length,
    from: days.length ? days[0].date : null,
    to: days.length ? days[days.length - 1].date : null,
    readonly: store.isReadonly(),
    backend: store.backend,
  });
}

function validIncoming(x: unknown): x is IncomingDay {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.date === 'string' &&
    isValidDate(o.date) &&
    (o.source === 'minhngoc' || o.source === 'seed') &&
    typeof o.day === 'object' &&
    o.day !== null &&
    Array.isArray((o.day as Record<string, unknown>).provinces)
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON không hợp lệ.' }, { status: 400 });
  }
  const list = (body as { days?: unknown }).days;
  if (!Array.isArray(list) || list.length === 0) {
    return NextResponse.json({ error: 'Cần { days: [...] } không rỗng.' }, { status: 400 });
  }
  const incoming: IncomingDay[] = [];
  for (const x of list) {
    if (validIncoming(x)) {
      incoming.push({ date: x.date, source: x.source, day: x.day });
    }
  }
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'Không có ngày hợp lệ nào.' }, { status: 400 });
  }
  const existing = await store.read([]);
  const { days, report } = mergeMasterdata(existing, incoming);
  // Không có gì mới → bỏ qua ghi để tránh commit/deploy thừa
  if (report.added === 0 && report.upgraded === 0) {
    return NextResponse.json({ ok: true, written: false, ...report });
  }
  try {
    await store.write(days);
  } catch (e) {
    if (isReadonlyError(e)) {
      return NextResponse.json(
        { error: 'Không ghi được masterdata (thiếu GITHUB_TOKEN trên server).' },
        { status: 501 },
      );
    }
    return NextResponse.json({ error: 'Không ghi được masterdata.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, written: true, ...report });
}
