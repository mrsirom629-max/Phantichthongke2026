#!/usr/bin/env node
/**
 * Sinh dữ liệu mẫu XSMB 90 ngày gần nhất — DETERMINISTIC (seed cố định).
 * Append vào data/seed.json (giữ nguyên các ngày XSMN đã có, thay thế ngày MB cũ).
 * Node thuần, không dependency. Chạy: `node scripts/gen-seed-mb.mjs`.
 *
 * Đặc tả XSMB (mirror MB_PRIZE_SPEC trong lib/constants.ts):
 * ĐB 1×5, nhất 1×5, nhì 2×5, ba 6×5, tư 4×4, năm 6×4, sáu 3×3, bảy 4×2 (27 giải).
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MB_PRIZE_KEYS = ['db', 'nhat', 'nhi', 'ba', 'tu', 'nam', 'sau', 'bay'];
const MB_PRIZE_COUNTS = { db: 1, nhat: 1, nhi: 2, ba: 6, tu: 4, nam: 6, sau: 3, bay: 4 };
const MB_PRIZE_DIGITS = { db: 5, nhat: 5, nhi: 5, ba: 5, tu: 4, nam: 4, sau: 3, bay: 2 };

const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const SEED = 20261001;
const DAYS = 90;

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

function todayVNParts() {
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

function main() {
  const rand = mulberry32(SEED);
  const { y, m, d } = todayVNParts();
  const todayMs = Date.UTC(y, m - 1, d);
  const pick = (digits) => String(Math.floor(rand() * Math.pow(10, digits))).padStart(digits, '0');

  const mbDays = [];
  for (let back = DAYS - 1; back >= 0; back--) {
    const dt = new Date(todayMs - back * 86400000);
    const yy = dt.getUTCFullYear();
    const mm = dt.getUTCMonth() + 1;
    const dd = dt.getUTCDate();
    const weekday = WEEKDAY_NAMES[dt.getUTCDay()];
    const prizes = { tam: [] };
    for (const key of MB_PRIZE_KEYS) {
      const arr = [];
      for (let i = 0; i < MB_PRIZE_COUNTS[key]; i++) arr.push(pick(MB_PRIZE_DIGITS[key]));
      prizes[key] = arr;
    }
    mbDays.push({
      date: fmtDDMMYYYY(yy, mm, dd),
      weekday,
      mien: 'bac',
      provinces: [{ province: 'Miền Bắc', code: 'XSMB', prizes }],
    });
  }

  const seedPath = join(ROOT, 'data', 'seed.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  const kept = seed.days.filter((x) => x.mien !== 'bac');
  seed.days = [...kept, ...mbDays];
  seed.meta = {
    ...seed.meta,
    note: 'Dữ liệu mẫu sinh tự động để demo offline (XSMN + XSMB)',
    generatedAt: new Date().toISOString(),
    days: seed.days.length,
  };

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
  console.log(`seed.json: ${kept.length} ngày XSMN + ${mbDays.length} ngày XSMB = ${seed.days.length} ngày`);
}

main();
