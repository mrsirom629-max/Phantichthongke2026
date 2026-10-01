/**
 * Sinh dữ liệu MẪU Power 6/55 (deterministic, mulberry32) — ghi rõ là seed.
 * 120 kỳ, quay Thứ 3/5/7, lùi từ 29-09-2026 (kỳ #01404).
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

function fmt(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// Lùi từ 29-09-2026, chỉ giữ Thứ 3/5/7
const draws = [];
const rng = mulberry32(6552901);
let d = new Date(2026, 8, 29);
let ky = 1404;
while (draws.length < 120) {
  const dow = d.getDay();
  if (dow === 2 || dow === 4 || dow === 6) {
    const pool = Array.from({ length: 55 }, (_, i) => i + 1);
    const nums = [];
    for (let i = 0; i < 6; i++) {
      nums.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    nums.sort((a, b) => a - b);
    const bonus = 1 + Math.floor(rng() * 55);
    draws.push({
      ky: String(ky).padStart(5, '0'),
      date: fmt(d),
      weekday: WEEKDAYS[dow],
      numbers: nums,
      bonus,
      jackpot1: 30000000000 + Math.floor(rng() * 70000000000),
      jackpot2: 3000000000 + Math.floor(rng() * 2000000000),
      seed: true,
    });
    ky--;
  }
  d.setDate(d.getDate() - 1);
}

const key = (s) => s.split('-').reverse().join(''); // YYYYMMDD
draws.sort((a, b) => (key(a.date) < key(b.date) ? 1 : -1)); // mới nhất trước
const out = {
  generatedAt: new Date().toISOString(),
  note: 'DỮ LIỆU MẪU — không phải kết quả thật. Kỳ quay thật lấy từ Minh Ngọc.',
  draws,
};
writeFileSync(join(__dirname, '..', 'data', 'seed-power655.json'), JSON.stringify(out, null, 1));
console.log(`seed-power655.json: ${draws.length} kỳ mẫu (${draws[draws.length - 1].date} → ${draws[0].date})`);
