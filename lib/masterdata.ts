/**
 * Masterdata — kho dữ liệu ngày đã tải, bền vững (GitHub/file).
 * Tính chất quan trọng: kết quả một ngày đã sổ là BẤT BIẾN → masterdata
 * chỉ append/nâng cấp, không bao giờ ghi đè dữ liệu live bằng dữ liệu cũ hơn.
 */
import type { DayResult } from './types';
import { cmpDate } from './stats';

export type DaySource = 'minhngoc' | 'seed';

export interface StoredDay extends DayResult {
  source: DaySource;
  updatedAt: string; // ISO
}

export interface IncomingDay {
  date: string; // DD-MM-YYYY
  source: DaySource;
  day: DayResult;
}

export interface MergeReport {
  added: number;
  upgraded: number;
  skipped: number;
  total: number;
  addedDates: string[];
  upgradedDates: string[];
}

/**
 * Gộp ngày mới vào masterdata:
 * - ngày CHƯA có → thêm (added)
 * - ngày đã có dạng seed, nay có live → nâng cấp (upgraded)
 * - còn lại → bỏ qua (skipped) — KHÔNG trùng lặp, KHÔNG ghi đè live bằng seed
 */
export function mergeMasterdata(existing: StoredDay[], incoming: IncomingDay[]): {
  days: StoredDay[];
  report: MergeReport;
} {
  const map = new Map<string, StoredDay>();
  for (const d of existing) map.set(d.date, d);
  const now = new Date().toISOString();
  let added = 0;
  let upgraded = 0;
  const addedDates: string[] = [];
  const upgradedDates: string[] = [];
  for (const inc of incoming) {
    if (!inc || !inc.day || !Array.isArray(inc.day.provinces)) continue;
    const cur = map.get(inc.date);
    if (!cur) {
      map.set(inc.date, { ...inc.day, source: inc.source, updatedAt: now });
      added += 1;
      addedDates.push(inc.date);
    } else if (cur.source === 'seed' && inc.source === 'minhngoc') {
      map.set(inc.date, { ...inc.day, source: 'minhngoc', updatedAt: now });
      upgraded += 1;
      upgradedDates.push(inc.date);
    }
  }
  const days = Array.from(map.values()).sort((a, b) => cmpDate(a.date, b.date));
  return {
    days,
    report: {
      added,
      upgraded,
      skipped: incoming.length - added - upgraded,
      total: days.length,
      addedDates,
      upgradedDates,
    },
  };
}

/** Các ngày trong [from..to] (DD-MM-YYYY) còn thiếu trong masterdata. */
export function missingDates(have: Set<string>, from: string, to: string): string[] {
  const out: string[] = [];
  const [fd, fm, fy] = from.split('-').map(Number);
  const [td, tm, ty] = to.split('-').map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    const dd = String(cur.getDate()).padStart(2, '0');
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const key = `${dd}-${mm}-${cur.getFullYear()}`;
    if (!have.has(key)) out.push(key);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
