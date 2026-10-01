/**
 * Lấy kết quả XSMN từ minhngoc.net.vn (nguồn công khai cho website nhúng).
 *
 * - Mỗi lần gọi chỉ fetch đúng 1 trang, header lịch sự, timeout 15s.
 * - Cache in-memory: thành công TTL 30 phút, thất bại TTL 60s.
 * - Parser chịu được nhiều biến thể HTML:
 *    + block từng tỉnh, các hàng giải theo thứ tự tám→bảy→sáu→năm→tư→ba→nhì→nhất→ĐB
 *    + có hoặc không có label "Giải tám"... trong HTML
 *    + thử mọi vị trí neo tên tỉnh (phòng nav/dropdown chứa tên tỉnh)
 * - Trả về kèm `stage` để chẩn đoán: ok | http-error | fetch-error | parse-error.
 */
import * as cheerio from 'cheerio';
import type { DayResult, PrizeSet, ProvinceResult } from './types';
import { MINHNGOC_BASE, XSMN_SCHEDULE, dayUrl } from './constants';

export type FetchStage = 'ok' | 'http-error' | 'fetch-error' | 'parse-error';

export interface FetchDetail {
  data: DayResult | null;
  stage: FetchStage;
  httpStatus?: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36 (xs-thong-ke/1.0)';
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const FAIL_CACHE_TTL_MS = 60 * 1000;

const cache = new Map<string, { at: number; detail: FetchDetail }>();

export async function fetchDayDetailed(date: string): Promise<FetchDetail> {
  const hit = cache.get(date);
  if (hit) {
    const ttl = hit.detail.stage === 'ok' ? CACHE_TTL_MS : FAIL_CACHE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.detail;
  }
  const detail = await fetchAndParse(date);
  cache.set(date, { at: Date.now(), detail });
  return detail;
}

/** Giữ API cũ: chỉ trả dữ liệu (null khi lỗi → caller fallback). */
export async function fetchDay(date: string): Promise<DayResult | null> {
  return (await fetchDayDetailed(date)).data;
}

/** Xóa cache (hữu ích cho test / cưỡng bức làm mới). */
export function clearCache(): void {
  cache.clear();
}

async function fetchAndParse(date: string): Promise<FetchDetail> {
  // ?mut=mn = "miền ưu tiên: miền Nam" (đúng URL người dùng cung cấp)
  const url = `${dayUrl(date)}?mut=mn`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9',
        Referer: `${MINHNGOC_BASE}/`,
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { data: null, stage: 'fetch-error' };
  }
  if (!res.ok) return { data: null, stage: 'http-error', httpStatus: res.status };
  let html = '';
  try {
    html = await res.text();
  } catch {
    return { data: null, stage: 'fetch-error', httpStatus: res.status };
  }
  const data = parsePage(html, date);
  return data
    ? { data, stage: 'ok', httpStatus: res.status }
    : { data: null, stage: 'parse-error', httpStatus: res.status };
}

// ─── Parser ─────────────────────────────────────────────────────────────────

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
const EXPECTED: Record<keyof PrizeSet, { count: number; digits: number }> = {
  tam: { count: 1, digits: 2 },
  bay: { count: 1, digits: 3 },
  sau: { count: 3, digits: 4 },
  nam: { count: 1, digits: 4 },
  tu: { count: 7, digits: 5 },
  ba: { count: 2, digits: 5 },
  nhi: { count: 1, digits: 5 },
  nhat: { count: 1, digits: 5 },
  db: { count: 1, digits: 6 },
};

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
    .replace(/đ/g, 'd') // "đ" không phân rã được dưới NFD → map tay
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

/** Nhận diện label "Giải tám"... (trên text đã chuẩn hóa). */
function labelKeyOf(n: string): keyof PrizeSet | null {
  if (/^giai\s*tam$/.test(n)) return 'tam';
  if (/^giai\s*bay$/.test(n)) return 'bay';
  if (/^giai\s*sau$/.test(n)) return 'sau';
  if (/^giai\s*nam$/.test(n)) return 'nam';
  if (/^giai\s*tu$/.test(n)) return 'tu';
  if (/^giai\s*ba$/.test(n)) return 'ba';
  if (/^giai\s*nhi$/.test(n)) return 'nhi';
  if (/^giai\s*nhat$/.test(n)) return 'nhat';
  if (/^giai\s*(dac\s*biet|db)$/.test(n)) return 'db';
  return null;
}

function emptyPrizes(): PrizeSet {
  return { db: [], nhat: [], nhi: [], ba: [], tu: [], nam: [], sau: [], bay: [], tam: [] };
}

function groupsComplete(g: PrizeSet): boolean {
  return GROUP_KEYS.every((k) => g[k].length === EXPECTED[k].count);
}

function groupsValid(g: PrizeSet): boolean {
  return GROUP_KEYS.every(
    (k) =>
      g[k].length === EXPECTED[k].count &&
      g[k].every((s) => s.length === EXPECTED[k].digits),
  );
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

/** Mọi vị trí neo ứng viên của một tỉnh (dòng tên tỉnh hoặc dòng mã đài). */
function findAnchors(
  lines: string[],
  from: number,
  to: number,
  nameNorm: string,
  codeNorm: string,
  limit = 12,
): number[] {
  const idxs: number[] = [];
  for (let i = from; i < to && idxs.length < limit; i++) {
    const n = norm(lines[i]);
    if (n.length < 3) continue;
    if (n.includes(nameNorm) || (codeNorm.length >= 3 && n.includes(codeNorm))) {
      idxs.push(i);
    }
  }
  return idxs;
}

/** Parse block tỉnh khi HTML CÓ label từng hàng giải. */
function parseLabeled(slice: string[]): PrizeSet | null {
  const g = emptyPrizes();
  let current: keyof PrizeSet | null = null;
  for (const line of slice) {
    const lk = labelKeyOf(norm(line));
    if (lk) {
      current = lk;
      continue;
    }
    if (/^\d+$/.test(line)) {
      if (!current) continue; // số rác trước label đầu tiên
      const exp = EXPECTED[current];
      if (line.length !== exp.digits) return null;
      if (g[current].length >= exp.count) {
        if (groupsComplete(g)) break; // đủ 9 hạng → dừng (tránh nuốt bảng loto "0..9")
        continue; // số thừa lẻ → bỏ qua
      }
      g[current].push(line);
      if (groupsComplete(g)) break;
      continue;
    }
    // dòng rác khác: bỏ qua
  }
  return groupsValid(g) ? g : null;
}

/** Parse block tỉnh khi HTML KHÔNG có label (gán theo vị trí tám→…→ĐB). */
function parsePositional(slice: string[]): PrizeSet | null {
  const digits: string[] = [];
  let started = false;
  for (const line of slice) {
    if (/^\d+$/.test(line)) {
      digits.push(line);
      started = true;
      continue;
    }
    if (started) break;
  }
  const g = emptyPrizes();
  let pos = 0;
  for (const k of GROUP_KEYS) {
    const exp = EXPECTED[k];
    const part = digits.slice(pos, pos + exp.count);
    if (part.length !== exp.count) return null;
    if (!part.every((s) => s.length === exp.digits)) return null;
    g[k] = part;
    pos += exp.count;
  }
  return g;
}

/**
 * Thử parse một tỉnh từ một vị trí neo. Block kết thúc ở tỉnh khác
 * (cùng lịch quay) hoặc hết section.
 */
function tryParseFromAnchor(
  lines: string[],
  anchorIdx: number,
  to: number,
  stopCheck: (n: string) => boolean,
): PrizeSet | null {
  let end = to;
  for (let i = anchorIdx + 1; i < to; i++) {
    if (stopCheck(norm(lines[i]))) {
      end = i;
      break;
    }
  }
  const slice = lines.slice(anchorIdx + 1, end);
  if (slice.length === 0) return null;
  const hasLabel = slice.some((l) => labelKeyOf(norm(l)) !== null);
  return hasLabel ? parseLabeled(slice) : parsePositional(slice);
}

/**
 * Parse toàn trang kết quả theo ngày. Chỉ lấy mục miền Nam của đúng ngày yêu cầu.
 * Chiến lược chính: dùng class HTML của trang (table.rightcl / td.giai8…td.giaidb /
 * div.giaiSo), giới hạn trong mục của đúng ngày (h1.pagetitle → div.box_kqxs).
 * Dự phòng: parser text-line cũ.
 * Exported để test được (không gọi trực tiếp từ route).
 */
export function parsePage(html: string, date: string): DayResult | null {
  return parsePageByClass(html, date) ?? parsePageByText(html, date);
}

// Map class ô giải → hạng giải
const PRIZE_CLASS_MAP: [string, keyof PrizeSet][] = [
  ['giai8', 'tam'],
  ['giai7', 'bay'],
  ['giai6', 'sau'],
  ['giai5', 'nam'],
  ['giai4', 'tu'],
  ['giai3', 'ba'],
  ['giai2', 'nhi'],
  ['giai1', 'nhat'],
  ['giaidb', 'db'],
];

/**
 * Parser chính: dựa vào class HTML thật của minhngoc.net.vn.
 * Mỗi tỉnh có <table class="rightcl"> riêng; tên tỉnh trong td.tinh;
 * các số trong td.giai8…td.giaidb > div.giaiSo.
 */
function parsePageByClass(html: string, date: string): DayResult | null {
  const weekday = weekdayOfDate(date);
  if (!weekday) return null;
  const schedule = XSMN_SCHEDULE[weekday];
  if (!schedule || schedule.length === 0) return null;

  const $ = cheerio.load(html);

  // h1 khớp đúng ngày yêu cầu
  let h1: ReturnType<typeof $> | null = null;
  $('h1.pagetitle').each((_, el) => {
    if (h1) return;
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec($(el).text());
    if (m && `${m[1]}-${m[2]}-${m[3]}` === date) h1 = $(el);
  });
  if (!h1) return null;

  // Các div.box_kqxs sau h1 này, trước h1 của ngày kế tiếp.
  // (TP. HCM xuất hiện cả thứ 2 và thứ 7 nên phải giới hạn theo ngày,
  // không quét toàn trang.)
  const boxes: ReturnType<typeof $>[] = [];
  let sib = h1.next();
  while (sib.length > 0 && !sib.is('h1.pagetitle')) {
    if (sib.is('div.box_kqxs')) boxes.push(sib);
    sib = sib.next();
  }
  const roots: ReturnType<typeof $>[] = boxes.length > 0 ? boxes : [$('body')];

  const provinces: ProvinceResult[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    root.find('table.rightcl').each((_, t) => {
      const name = $(t).find('td.tinh').first().text().replace(/\s+/g, ' ').trim();
      const nn = norm(name);
      const target = schedule.find((s) => {
        const tn = norm(s.province);
        return nn.length >= 3 && tn.length >= 3 && (nn === tn || nn.includes(tn));
      });
      if (!target || seen.has(target.province)) return;
      const prizes = emptyPrizes();
      let ok = true;
      for (const [cls, key] of PRIZE_CLASS_MAP) {
        const nums: string[] = [];
        $(t)
          .find(`td.${cls} div.giaiSo`)
          .each((_, d) => {
            const v = $(d).text().replace(/\s+/g, '').trim();
            if (/^\d+$/.test(v)) nums.push(v);
          });
        const exp = EXPECTED[key];
        if (nums.length !== exp.count || !nums.every((s) => s.length === exp.digits)) {
          ok = false;
          break;
        }
        prizes[key] = nums;
      }
      if (ok) {
        seen.add(target.province);
        provinces.push({ province: target.province, code: target.code, prizes });
      }
    });
    if (provinces.length > 0) break;
  }
  if (provinces.length === 0) return null;

  // Sắp xếp theo đúng lịch quay để thứ tự cột ổn định
  const order = new Map(schedule.map((s, i) => [s.province, i]));
  provinces.sort((a, b) => (order.get(a.province) ?? 99) - (order.get(b.province) ?? 99));
  return { date, weekday, mien: 'nam', provinces };
}

/**
 * Parser dự phòng: text-line (khi cấu trúc class thay đổi).
 * Lưu ý: cột label của chính miền Nam cũng chứa "Giải ĐB" nên section
 * chỉ kết thúc ở mục Điện toán / miền khác, không cắt ở "giaidb".
 */
function parsePageByText(html: string, date: string): DayResult | null {
  const lines = htmlToLines(html);
  if (lines.length === 0) return null;

  // 1. Heading khớp đúng ngày yêu cầu (trang có thể chứa link/nav ngày khác
  //    đứng trước; trang còn liệt kê các ngày cũ hơn phía sau)
  const headingRe = /KẾT QUẢ XỔ SỐ[^\d]*(\d{2})\/(\d{2})\/(\d{4})/i;
  let headIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m && `${m[1]}-${m[2]}-${m[3]}` === date) {
      headIdx = i;
      break;
    }
  }
  if (headIdx < 0) return null;

  // 2. Giới hạn section miền Nam: đến mục Điện toán / miền Bắc / miền Trung
  //    hoặc heading ngày kế tiếp. KHÔNG cắt ở "giaidb" vì cột label của chính
  //    miền Nam cũng chứa "Giải ĐB"; bỏ qua title "KẾT QUẢ XỔ SỐ Miền Nam".
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    const n = norm(lines[i]);
    if (!/ketquaxoso/.test(n)) continue;
    if (/miennam/.test(n)) continue; // chính mục miền Nam đang xét
    endIdx = i;
    break;
  }

  // 3. Lịch tỉnh theo thứ của ngày yêu cầu
  const weekday = weekdayOfDate(date);
  if (!weekday) return null;
  const schedule = XSMN_SCHEDULE[weekday];
  if (!schedule || schedule.length === 0) return null;

  const provinces: ProvinceResult[] = [];
  for (const s of schedule) {
    const nameNorm = norm(s.province);
    const codeNorm = norm(s.code);
    const others = schedule.filter((o) => o.province !== s.province);
    const otherNames = others.map((o) => norm(o.province));
    const otherCodes = others.map((o) => norm(o.code)).filter((c) => c.length >= 3);
    const stopCheck = (n: string): boolean => {
      if (n.length < 3) return false;
      if (otherNames.some((on) => on.length >= 3 && n.includes(on))) return true;
      if (otherCodes.some((oc) => n.includes(oc))) return true;
      return false;
    };
    const anchors = findAnchors(lines, headIdx, endIdx, nameNorm, codeNorm);
    let prizes: PrizeSet | null = null;
    for (const a of anchors) {
      prizes = tryParseFromAnchor(lines, a, endIdx, stopCheck);
      if (prizes) break;
    }
    if (prizes) provinces.push({ province: s.province, code: s.code, prizes });
  }
  if (provinces.length === 0) return null;

  return { date, weekday, mien: 'nam', provinces };
}
