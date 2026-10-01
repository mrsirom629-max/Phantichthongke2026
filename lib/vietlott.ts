/**
 * Vietlott Power 6/55 — lấy & parse kết quả từ Minh Ngọc.
 *
 * - Quay thưởng: Thứ 3, Thứ 5, Thứ 7 hàng tuần.
 * - Mỗi kỳ: 6 số chính (01–55, không trùng) + 1 số đặc biệt (bonus, quay từ
 *   55 bóng nên CÓ THỂ trùng số chính).
 * - URL theo ngày: .../dien-toan-vietlott/power-6x55/DD-MM-YYYY.html
 *   Mỗi trang chứa ~10 kỳ gần nhất tính đến ngày đó.
 */
import * as cheerio from 'cheerio';

export interface PowerPrize {
  name: string;
  winners: number;
  value: number; // đồng
}

export interface PowerDraw {
  ky: string; // "01404"
  date: string; // DD-MM-YYYY
  weekday: string;
  numbers: number[]; // 6 số chính, tăng dần
  bonus: number; // số đặc biệt
  jackpot1: number; // giá trị Jackpot 1 (đồng)
  jackpot2: number; // giá trị Jackpot 2 (đồng)
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function powerUrl(dateDDMMYYYY: string): string {
  return `https://www.minhngoc.net.vn/ket-qua-xo-so/dien-toan-vietlott/power-6x55/${dateDDMMYYYY}.html`;
}

function num(t: string): number | null {
  const m = t.replace(/[^\d]/g, '');
  if (!m) return null;
  const n = parseInt(m, 10);
  return Number.isFinite(n) ? n : null;
}

function money(t: string): number {
  const n = num(t);
  return n ?? 0;
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

export function weekdayOf(date: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(date);
  if (!m) return '';
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return WEEKDAYS[d.getDay()] ?? '';
}

/**
 * Parse TẤT CẢ các kỳ Power 6/55 trong một trang HTML (defensive:
 * khối nào thiếu số thì bỏ qua, không làm hỏng các kỳ khác).
 */
export function parsePowerPage(html: string): PowerDraw[] {
  const $ = cheerio.load(html);
  const draws: PowerDraw[] = [];

  $('.boxkqxsdientoan').each((_, box) => {
    try {
      const $box = $(box);
      const text = $box.text();

      const kyM = text.match(/Kỳ vé:\s*#?(\d{3,6})/);
      const dateM = text.match(/Ngày quay thưởng\s*(\d{2})\/(\d{2})\/(\d{4})/);
      if (!kyM || !dateM) return;
      const ky = kyM[1];
      const date = `${dateM[1]}-${dateM[2]}-${dateM[3]}`;

      const nums: number[] = [];
      for (let i = 1; i <= 6; i++) {
        const t = $box.find(`.finnish${i}`).first().text().trim();
        const n = num(t);
        if (n === null || n < 1 || n > 55) return; // thiếu số chính -> bỏ kỳ này
        nums.push(n);
      }
      if (new Set(nums).size !== 6) return; // 6 số chính phải phân biệt
      const bonusT = $box.find('.finnish7').first().text().trim();
      const bonus = num(bonusT);
      if (bonus === null || bonus < 1 || bonus > 55) return;

      // Bảng giải thưởng: mỗi hàng .giai_thuong_text -> .giai_thuong_gia_tri
      // (id DT6X55_S_JACKPOT* chứa SỐ NGƯỜI TRÚNG, không phải giá trị giải)
      let jackpot1 = 0;
      let jackpot2 = 0;
      $box.find('tr').each((_, tr) => {
        const $tr = $(tr);
        const name = $tr.find('.giai_thuong_text').first().text().trim();
        if (!/jackpot/i.test(name)) return;
        const val = money($tr.find('.giai_thuong_gia_tri').first().text());
        if (/jackpot\s*2/i.test(name)) jackpot2 = val;
        else if (/jackpot\s*1/i.test(name)) jackpot1 = val;
      });

      draws.push({
        ky,
        date,
        weekday: weekdayOf(date),
        numbers: nums.slice().sort((a, b) => a - b),
        bonus,
        jackpot1,
        jackpot2,
      });
    } catch {
      /* bỏ qua khối lỗi, giữ các kỳ khác */
    }
  });

  // Khử trùng theo kỳ, mới nhất trước
  const seen = new Set<string>();
  return draws.filter((d) => {
    if (seen.has(d.ky)) return false;
    seen.add(d.ky);
    return true;
  });
}

export type FetchStage = 'ok' | 'empty' | 'error';

export interface PowerFetchResult {
  stage: FetchStage;
  draws: PowerDraw[];
}

/** Tải một trang ngày, trả về các kỳ trong trang đó. */
export async function fetchPowerPage(date: string): Promise<PowerFetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(powerUrl(date), {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return { stage: 'error', draws: [] };
    const html = await res.text();
    const draws = parsePowerPage(html);
    return { stage: draws.length > 0 ? 'ok' : 'empty', draws };
  } catch {
    return { stage: 'error', draws: [] };
  } finally {
    clearTimeout(timer);
  }
}
