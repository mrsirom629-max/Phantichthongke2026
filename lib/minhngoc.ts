/**
 * Lấy kết quả XSMN từ minhngoc.net.vn (nguồn công khai cho website nhúng).
 *
 * - Mỗi lần gọi chỉ fetch đúng 1 trang, User-Agent lịch sự, timeout 15s.
 * - Cache in-memory TTL 30 phút cho kết quả thành công (lỗi mạng cache ngắn
 *   60s để tránh spam khi sự cố kéo dài).
 * - Parser defensive: tách block từng tỉnh theo XSMN_SCHEDULE, gán giải theo
 *   vị trí (tám→đặc biệt), validate độ dài chữ số; block lỗi bị bỏ qua thay vì crash.
 * - Trả null khi không parse được / lỗi mạng → caller fallback sang seed.
 */
import * as cheerio from 'cheerio';
import type { DayResult, PrizeSet, ProvinceResult } from './types';
import { XSMN_SCHEDULE, dayUrl } from './constants';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36 (xs-thong-ke/1.0; contact: admin@localhost)';
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const FAIL_CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  at: number;
  data: DayResult | null;
}
const cache = new Map<string, CacheEntry>();

export async function fetchDay(date: string): Promise<DayResult | null> {
  const hit = cache.get(date);
  if (hit) {
    const ttl = hit.data ? CACHE_TTL_MS : FAIL_CACHE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.data;
  }
  let data: DayResult | null = null;
  try {
    data = await fetchAndParse(date);
  } catch {
    data = null; // lỗi mạng / parse → caller fallback
  }
  cache.set(date, { at: Date.now(), data });
  return data;
}

/** Xóa cache (hữu ích cho test / cưỡng bức làm mới). */
export function clearCache(): void {
  cache.clear();
}

async function fetchAndParse(date: string): Promise<DayResult | null> {
  const res = await fetch(dayUrl(date), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'vi-VN,vi;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const html = await res.text();
  return parsePage(html, date);
}

// ─── Parser ─────────────────────────────────────────────────────────────────

// Thứ tự hàng giải trong block của một tỉnh (tám → đặc biệt)
const GROUP_KEYS: (keyof PrizeSet)[] = [
  'tam',
  'bay',
  'sau',
  'nam',
  'tu',
  'ba',
  'nhi',
  'nhat',
  'db',
];
// Số lượng số mỗi hàng giải (XSMN): tám×1, bảy×1, sáu×3, năm×1, tư×7, ba×2, nhì×1, nhất×1, ĐB×1
const GROUP_COUNTS = [1, 1, 3, 1, 7, 2, 1, 1, 1];
// Độ dài chữ số mỗi hàng giải
const GROUP_DIGITS = [2, 3, 4, 4, 5, 5, 5, 5, 6];

const VN_WEEKDAYS = [
  'Chủ nhật',
  'Thứ hai',
  'Thứ ba',
  'Thứ tư',
  'Thứ năm',
  'Thứ sáu',
  'Thứ bảy',
];

/** Chuẩn hóa để so khớp tên tỉnh: bỏ dấu, thường hóa, chỉ giữ a-z0-9. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Thứ trong tuần từ "DD-MM-YYYY" (tính theo UTC để không lệch múi giờ). */
function weekdayOfDate(date: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(date.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1]) {
    return null;
  }
  return VN_WEEKDAYS[d.getUTCDay()];
}

/**
 * Tách HTML thành các dòng text, giữ ranh giới <br> và các block
 * để mỗi con số nằm trên một dòng riêng.
 */
function htmlToLines(html: string): string[] {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe').remove();
  let body = $('body').html() ?? '';
  body = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|td|th|li|h[1-6]|table|section|article|header|footer|ul|ol)>/gi, '\n');
  const text = cheerio.load(`<div>${body}</div>`)('div').text();
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

/**
 * Parse một block tỉnh: tìm dòng tên tỉnh, sau đó thu thập các dòng toàn chữ số
 * (bỏ qua dòng mã đài như "XSDN - 9K5"), rồi gán theo vị trí + validate độ dài.
 * Trả null nếu block lỗi (không đủ số / sai độ dài chữ số).
 *
 * Ghi chú: block XSMN của minhngoc không có label từng hàng giải ("Giải tám"...),
 * nên chỉ dùng được map theo vị trí; khi không khớp kỳ vọng thì bỏ qua block.
 */
function parseProvinceBlock(
  lines: string[],
  from: number,
  to: number,
  provinceName: string,
  code: string,
): PrizeSet | null {
  const target = norm(provinceName);
  const codeNorm = norm(code);
  let nameIdx = -1;

  // Neo 1: dòng tên tỉnh
  for (let i = from; i < to; i++) {
    const n = norm(lines[i]);
    if (n.length >= 3 && (n.includes(target) || (n.length >= 4 && target.includes(n)))) {
      nameIdx = i;
      break;
    }
  }
  // Neo 2 (dự phòng): dòng mã đài, ví dụ "XSDN - 9K5"
  if (nameIdx < 0 && codeNorm.length >= 3) {
    for (let i = from; i < to; i++) {
      if (norm(lines[i]).includes(codeNorm)) {
        nameIdx = i;
        break;
      }
    }
  }
  if (nameIdx < 0) return null;

  const digits: string[] = [];
  let started = false;
  for (let i = nameIdx + 1; i < to; i++) {
    const line = lines[i];
    if (/^\d+$/.test(line)) {
      digits.push(line);
      started = true;
      continue;
    }
    if (started) break; // hết dãy số của block này
  }

  const prizes: PrizeSet = {
    db: [],
    nhat: [],
    nhi: [],
    ba: [],
    tu: [],
    nam: [],
    sau: [],
    bay: [],
    tam: [],
  };
  let pos = 0;
  for (let g = 0; g < GROUP_KEYS.length; g++) {
    const slice = digits.slice(pos, pos + GROUP_COUNTS[g]);
    if (slice.length !== GROUP_COUNTS[g]) return null;
    if (!slice.every((s) => s.length === GROUP_DIGITS[g])) return null;
    prizes[GROUP_KEYS[g]] = slice;
    pos += GROUP_COUNTS[g];
  }
  return prizes;
}

/**
 * Parse toàn trang kết quả theo ngày. Chỉ lấy mục miền Nam của đúng ngày yêu cầu.
 * Exported để test được (không gọi trực tiếp từ route).
 */
export function parsePage(html: string, date: string): DayResult | null {
  const lines = htmlToLines(html);
  if (lines.length === 0) return null;

  // 1. Heading ngày đầu tiên phải khớp ngày yêu cầu (trang còn liệt kê ngày cũ hơn)
  const headingRe = /KẾT QUẢ XỔ SỐ[^\d]*(\d{2})\/(\d{2})\/(\d{4})/i;
  let headIdx = -1;
  let headDate = '';
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m) {
      headIdx = i;
      headDate = `${m[1]}-${m[2]}-${m[3]}`;
      break;
    }
  }
  if (headIdx < 0 || headDate !== date) return null;

  // 2. Giới hạn section miền Nam: đến block XSMB ("Giải ĐB") hoặc heading ngày kế tiếp
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    const n = norm(lines[i]);
    if (n === 'giaidb' || n.startsWith('giaidb')) {
      endIdx = i;
      break;
    }
    if (/kết quả xổ số/i.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  // 3. Lịch tỉnh theo thứ của ngày yêu cầu
  const weekday = weekdayOfDate(date);
  if (!weekday) return null;
  const schedule = XSMN_SCHEDULE[weekday];
  if (!schedule || schedule.length === 0) return null;

  const provinces: ProvinceResult[] = [];
  for (const s of schedule) {
    const prizes = parseProvinceBlock(lines, headIdx, endIdx, s.province, s.code);
    if (prizes) provinces.push({ province: s.province, code: s.code, prizes });
  }
  if (provinces.length === 0) return null;

  return { date, weekday, mien: 'nam', provinces };
}
