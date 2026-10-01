/**
 * Engine thống kê thuần túy — dùng được cả server & client.
 * Mọi hàm đều pure (không fetch, không side-effect).
 */
import type { DayResult, NumberStat, PrizeSet, StatsResult } from './types';

/** 2 chữ số cuối của mọi giải trong một bộ PrizeSet (18 số/đài/ngày XSMN). */
export function lotoOf(prizes: PrizeSet): string[] {
  const all = [
    ...prizes.tam,
    ...prizes.bay,
    ...prizes.sau,
    ...prizes.nam,
    ...prizes.tu,
    ...prizes.ba,
    ...prizes.nhi,
    ...prizes.nhat,
    ...prizes.db,
  ];
  return all.map((s) => s.slice(-2));
}

// ─── Helpers ngày tháng ("DD-MM-YYYY", múi giờ VN) ────────────────────────────

interface YMD {
  d: number;
  m: number;
  y: number;
}

/** Parse "DD-MM-YYYY" → {d,m,y}, null nếu sai định dạng hoặc ngày không tồn tại. */
export function parseD(s: string): YMD | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  const y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null; // ngày không tồn tại, ví dụ 31-02
  }
  return { d, m: mo, y };
}

function toUTCms(p: YMD): number {
  return Date.UTC(p.y, p.m - 1, p.d);
}

/** Số ngày từ a đến b (b - a). Trả NaN nếu định dạng sai. */
export function diffDays(a: string, b: string): number {
  const pa = parseD(a);
  const pb = parseD(b);
  if (!pa || !pb) return NaN;
  return Math.round((toUTCms(pb) - toUTCms(pa)) / 86400000);
}

/** Cộng n ngày (n có thể âm) vào chuỗi "DD-MM-YYYY". */
export function addDays(s: string, n: number): string {
  const p = parseD(s);
  if (!p) throw new Error(`Ngày không hợp lệ: ${s}`);
  const dt = new Date(toUTCms(p) + n * 86400000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(dt.getUTCDate())}-${pad(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
}

/** Hôm nay theo giờ Việt Nam, định dạng "DD-MM-YYYY". */
export function todayVN(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // "YYYY-MM-DD"
  const [y, mo, d] = parts.split('-');
  return `${d}-${mo}-${y}`;
}

/** So sánh 2 chuỗi ngày theo thứ tự thời gian: -1 | 0 | 1. */
export function cmpDate(a: string, b: string): number {
  const d = diffDays(a, b); // = (b - a) theo ngày
  if (Number.isNaN(d)) return 0;
  return d === 0 ? 0 : d > 0 ? -1 : 1; // d>0 nghĩa là b muộn hơn → a đứng trước → -1
}

/** Kiểm tra chuỗi \"DD-MM-YYYY\" có phải ngày dương lịch hợp lệ (đúng số ngày/tháng). */
export function isValidDate(s: string): boolean {
  if (typeof s !== 'string' || !/^\d{2}-\d{2}-\d{4}$/.test(s)) return false;
  const [d, m, y] = s.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); // ngày cuối tháng m
  return d <= dim;
}

// ─── Trích draws trong khoảng ────────────────────────────────────────────────

export interface DrawNumbers {
  date: string;
  province: string;
  numbers: string[]; // lô tô 2 chữ số
}

/**
 * Lọc các lượt quay trong [from, to] (bao gồm biên), mỗi đài một dòng.
 * @param province "all"/undefined → mọi đài; ngược lại khớp tên tỉnh hoặc mã đài.
 */
export function drawsInRange(
  all: DayResult[],
  from: string,
  to: string,
  province?: string,
): DrawNumbers[] {
  const out: DrawNumbers[] = [];
  for (const day of all) {
    if (cmpDate(day.date, from) < 0 || cmpDate(day.date, to) > 0) continue;
    for (const p of day.provinces) {
      if (province && province !== 'all' && p.province !== province && p.code !== province) {
        continue;
      }
      out.push({ date: day.date, province: p.province, numbers: lotoOf(p.prizes) });
    }
  }
  out.sort((a, b) => cmpDate(a.date, b.date) || a.province.localeCompare(b.province));
  return out;
}

// ─── Thống kê ───────────────────────────────────────────────────────────────

/**
 * Tính tần suất lô tô 00–99 trên các draws (đã sắp xếp tăng dần theo ngày).
 * - count: tổng số lần xuất hiện (một số về 2 nháy trong 1 đài = 2 lần).
 * - lastSeen: ngày gần nhất xuất hiện (null nếu chưa từng về).
 * - gapDays: số ngày vắng tính đến ngày cuối cùng trong range (null nếu chưa từng về).
 * - hot: top theo count; cold: bottom theo count (gồm số 0 lần); gan: top theo gapDays.
 */
export function computeStats(
  draws: DrawNumbers[],
  topN = 10,
  province = 'all',
): StatsResult {
  const counts = new Array<number>(100).fill(0);
  const lastSeen: (string | null)[] = new Array(100).fill(null);

  for (const dr of draws) {
    for (const n of dr.numbers) {
      const i = parseInt(n, 10);
      if (Number.isNaN(i) || i < 0 || i > 99) continue;
      counts[i] += 1;
      lastSeen[i] = dr.date; // draws đã sort tăng dần → lần gán cuối là gần nhất
    }
  }

  const to: string = draws.length > 0 ? draws[draws.length - 1].date : '';
  const from: string = draws.length > 0 ? draws[0].date : '';

  const freq: NumberStat[] = [];
  for (let i = 0; i < 100; i++) {
    const ls = lastSeen[i];
    freq.push({
      number: String(i).padStart(2, '0'),
      count: counts[i],
      lastSeen: ls,
      gapDays: ls === null || to === '' ? null : diffDays(ls, to),
    });
  }

  const byCountDesc = [...freq].sort((a, b) => b.count - a.count || a.number.localeCompare(b.number));
  const byCountAsc = [...freq].sort((a, b) => a.count - b.count || a.number.localeCompare(b.number));
  const byGapDesc = [...freq]
    .filter((s) => s.gapDays !== null)
    .sort((a, b) => (b.gapDays as number) - (a.gapDays as number) || a.number.localeCompare(b.number));

  return {
    from,
    to,
    province,
    freq,
    hot: byCountDesc.slice(0, topN),
    cold: byCountAsc.slice(0, topN),
    gan: byGapDesc.slice(0, topN),
    totalDraws: draws.length,
  };
}
