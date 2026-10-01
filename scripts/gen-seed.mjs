#!/usr/bin/env node
/**
 * Sinh dữ liệu mẫu XSMN 90 ngày gần nhất — DETERMINISTIC (seed cố định).
 * Node thuần, không dependency. Chạy: `node scripts/gen-seed.mjs` hoặc `npm run seed`.
 *
 * LƯU Ý: các bảng XSMN_SCHEDULE / PRIZE_COUNTS / PRIZE_DIGITS dưới đây được
 * mirror từ `lib/constants.ts`. Nếu sửa contract, hãy đồng bộ lại file này.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Mirror từ lib/constants.ts ─────────────────────────────────────────────
const XSMN_SCHEDULE = {
  'Thứ hai': [
    { province: 'TP. HCM', code: 'XSHCM' },
    { province: 'Đồng Tháp', code: 'XSDT' },
    { province: 'Cà Mau', code: 'XSCM' },
  ],
  'Thứ ba': [
    { province: 'Bến Tre', code: 'XSBT' },
    { province: 'Vũng Tàu', code: 'XSVT' },
    { province: 'Bạc Liêu', code: 'XSBL' },
  ],
  'Thứ tư': [
    { province: 'Đồng Nai', code: 'XSDN' },
    { province: 'Cần Thơ', code: 'XSCT' },
    { province: 'Sóc Trăng', code: 'XSST' },
  ],
  'Thứ năm': [
    { province: 'Tây Ninh', code: 'XSTN' },
    { province: 'An Giang', code: 'XSAG' },
    { province: 'Bình Thuận', code: 'XSBTH' },
  ],
  'Thứ sáu': [
    { province: 'Vĩnh Long', code: 'XSVL' },
    { province: 'Bình Dương', code: 'XSBD' },
    { province: 'Trà Vinh', code: 'XSTV' },
  ],
  'Thứ bảy': [
    { province: 'TP. HCM', code: 'XSHCM' },
    { province: 'Long An', code: 'XSLA' },
    { province: 'Bình Phước', code: 'XSBP' },
    { province: 'Hậu Giang', code: 'XSHG' },
  ],
  'Chủ nhật': [
    { province: 'Tiền Giang', code: 'XSTG' },
    { province: 'Kiên Giang', code: 'XSKG' },
    { province: 'Đà Lạt', code: 'XSDL' },
  ],
};

// Thứ tự giải từ thấp đến cao (khớp PRIZE_ORDER trong lib/types.ts)
const PRIZE_KEYS = ['tam', 'bay', 'sau', 'nam', 'tu', 'ba', 'nhi', 'nhat', 'db'];
const PRIZE_COUNTS = { db: 1, nhat: 1, nhi: 1, ba: 2, tu: 7, nam: 1, sau: 3, bay: 1, tam: 1 };
const PRIZE_DIGITS = { db: 6, nhat: 5, nhi: 5, ba: 5, tu: 5, nam: 4, sau: 4, bay: 3, tam: 2 };

const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const SEED = 20260930;
const DAYS = 90;

// ─── PRNG: mulberry32 (deterministic) ────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Helpers ngày (UTC, deterministic) ───────────────────────────────────────
function todayVNParts() {
  // "YYYY-MM-DD" theo giờ VN
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function fmtDDMMYYYY(y, m, d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d)}-${p(m)}-${y}`;
}

// ─── Sinh dữ liệu ───────────────────────────────────────────────────────────
function main() {
  const rand = mulberry32(SEED);
  const { y, m, d } = todayVNParts();
  const todayMs = Date.UTC(y, m - 1, d);

  const pick = (digits) => {
    const n = Math.floor(rand() * Math.pow(10, digits));
    return String(n).padStart(digits, '0');
  };

  const days = [];
  for (let back = DAYS - 1; back >= 0; back--) {
    const dt = new Date(todayMs - back * 86400000);
    const yy = dt.getUTCFullYear();
    const mm = dt.getUTCMonth() + 1;
    const dd = dt.getUTCDate();
    const weekday = WEEKDAY_NAMES[dt.getUTCDay()];
    const provinces = (XSMN_SCHEDULE[weekday] || []).map(({ province, code }) => {
      const prizes = {};
      for (const key of PRIZE_KEYS) {
        const arr = [];
        for (let i = 0; i < PRIZE_COUNTS[key]; i++) arr.push(pick(PRIZE_DIGITS[key]));
        prizes[key] = arr;
      }
      return { province, code, prizes };
    });
    days.push({
      date: fmtDDMMYYYY(yy, mm, dd),
      weekday,
      mien: 'nam',
      provinces,
    });
  }

  const out = {
    meta: {
      source: 'seed',
      note: 'Dữ liệu mẫu sinh tự động để demo offline',
      generatedAt: new Date().toISOString(),
      days: days.length,
      seed: SEED,
    },
    days,
  };

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(join(ROOT, 'data', 'seed.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[seed] wrote data/seed.json — ${days.length} ngày, ${days[0].date} → ${days[days.length - 1].date}`);
}

main();
