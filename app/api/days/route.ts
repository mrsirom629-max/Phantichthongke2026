import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import type { DayResult } from '@/lib/types';

/**
 * GET /api/days — trả về DayResult[] thô từ seed (data/seed.json).
 * Trang lab dùng để dựng dataset huấn luyện mạng nơ-ron.
 * Chưa có seed -> trả mảng rỗng, trang lab sẽ báo thiếu dữ liệu.
 */
export async function GET() {
  try {
    const file = path.join(process.cwd(), 'data', 'seed.json');
    const raw = await fs.readFile(file, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const days: DayResult[] = Array.isArray(parsed)
      ? (parsed as DayResult[])
      : ((parsed as { days?: DayResult[] }).days ?? []);
    return NextResponse.json(days);
  } catch {
    return NextResponse.json([] as DayResult[]);
  }
}
