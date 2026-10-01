/**
 * Tải N ngày gần nhất (kết thúc hôm nay) từ /api/results — mỗi ngày API đã thử
 * lấy live từ minhngoc.net.vn trước, fallback seed khi thất bại.
 *
 * - Chạy trên client: gom N ngày bằng các request nhỏ (mỗi request được cache
 *   30 phút phía server) thay vì một API "gồng" 90 trang (dính timeout serverless).
 * - Giới hạn đồng thời CONCURRENCY để lịch sự với nguồn.
 * - Cache trong memory của tab browser: tải lại cùng khoảng ngày là tức thì.
 * - Trung thực: đếm rõ mỗi ngày là live hay seed để UI hiển thị đúng.
 */
import { addDays, cmpDate, todayVN } from './stats';
import type { DayResult } from './types';

const CONCURRENCY = 5;
const CLIENT_TIMEOUT_MS = 25_000;

export interface LiveDayResult {
  days: DayResult[]; // sắp xếp tăng dần theo ngày
  live: number; // số ngày lấy trực tiếp từ Minh Ngọc
  seed: number; // số ngày phải dùng dữ liệu mẫu
  total: number; // tổng số ngày yêu cầu
  perDay: { date: string; source: 'minhngoc' | 'seed' }[];
}

interface CacheEntry {
  source: 'minhngoc' | 'seed';
  day: DayResult | null;
}

const memCache = new Map<string, CacheEntry>();

async function loadOne(date: string): Promise<CacheEntry> {
  const hit = memCache.get(date);
  if (hit) return hit;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/results?date=${encodeURIComponent(date)}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      source?: string;
      data?: DayResult | null;
    };
    const source: 'minhngoc' | 'seed' =
      json?.source === 'minhngoc' || json?.source === 'live' ? 'minhngoc' : 'seed';
    const entry: CacheEntry = { source, day: json?.data ?? null };
    memCache.set(date, entry);
    return entry;
  } catch {
    // Lỗi mạng/timeout: không cache để lần sau thử lại
    return { source: 'seed', day: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tải daysN ngày gần nhất. onProgress(done, total) để UI hiện tiến trình.
 * Ngày nào API trả data=null (chưa quay / không có số liệu) thì bỏ qua.
 */
export async function loadDaysLive(
  daysN: number,
  onProgress?: (done: number, total: number) => void,
): Promise<LiveDayResult> {
  const n = Math.min(Math.max(Math.floor(daysN) || 30, 1), 365);
  const to = todayVN();
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) dates.push(addDays(to, -i));

  const slots: (CacheEntry | null)[] = new Array(dates.length).fill(null);
  let done = 0;
  const worker = async (w: number) => {
    for (let i = w; i < dates.length; i += CONCURRENCY) {
      slots[i] = await loadOne(dates[i]);
      done += 1;
      onProgress?.(done, dates.length);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));

  const days: DayResult[] = [];
  const perDay: { date: string; source: 'minhngoc' | 'seed' }[] = [];
  let live = 0;
  let seed = 0;
  dates.forEach((date, i) => {
    const s = slots[i];
    perDay.push({ date, source: s?.source ?? 'seed' });
    if (s?.day) {
      days.push(s.day);
      if (s.source === 'minhngoc') live += 1;
      else seed += 1;
    }
  });
  days.sort((a, b) => cmpDate(a.date, b.date));
  return { days, live, seed, total: n, perDay };
}

/** Xóa cache client (khi muốn ép tải lại toàn bộ). */
export function clearLiveCache(): void {
  memCache.clear();
}
