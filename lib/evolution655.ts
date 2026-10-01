/**
 * Vòng lặp TỰ TIẾN HÓA cho hệ NN + Solver Power 6/55:
 *   gợi ý → so sánh với kết quả thật → cải tiến thuật toán.
 *
 * TRUNG THỰC: các kỳ quay độc lập ngẫu nhiên nên "độ chính xác" của mọi hệ
 * thống đều tiệm cận về kỳ vọng ngẫu nhiên (hits TB/vé = 36/55 ≈ 0.65).
 * Vòng lặp này (1) chứng minh điều đó bằng dữ liệu thật, và (2) cải tiến
 * những gì cải tiến được: loss của NN, chất lượng objective của solver,
 * độ bao phủ danh mục vé.
 */
import type { PowerDraw } from './vietlott';

export const EVO_KEY = 'p65-evo-v1';

/** Kỳ vọng số trúng/vé (6 số) của việc chọn ngẫu nhiên: 6*6/55. */
export const BASELINE_MEAN_HITS = 36 / 55; // ≈ 0.6545

export interface SolverConfig {
  lookback: number;
  hidden: number;
  epochs: number;
  tickets: number;
  lambda: number;
}

export interface EvoEntry {
  id: string;
  /** Ngày kỳ cần đối chiếu (backtest) — hoặc rỗng nếu chờ "kỳ sau afterDate". */
  targetDate: string;
  afterDate: string;
  ky: string;
  config: SolverConfig;
  tickets: number[][];
  totalScore: number;
  coverage: number;
  createdAt: number;
  status: 'pending' | 'done';
  actual: number[] | null;
  hits: number[] | null;
  meanHits: number | null;
}

const dateKey = (s: string) => s.split('-').reverse().join('');

export function loadEvoEntries(): EvoEntry[] {
  try {
    const raw = localStorage.getItem(EVO_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as EvoEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveEvoEntries(list: EvoEntry[]): void {
  try {
    localStorage.setItem(EVO_KEY, JSON.stringify(list));
  } catch {
    /* bỏ qua */
  }
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Đối chiếu 1 gợi ý với KQ thật trong dữ liệu đã tải.
 * Trả về entry nguyên trạng nếu chưa có KQ (vẫn pending).
 */
export function reconcileEntry(e: EvoEntry, draws: PowerDraw[]): EvoEntry {
  if (e.status === 'done') return e;
  let actual: PowerDraw | undefined;
  if (e.targetDate) {
    actual = draws.find((d) => d.date === e.targetDate);
  } else if (e.afterDate) {
    const cands = draws
      .filter((d) => dateKey(d.date) > dateKey(e.afterDate))
      .sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? -1 : 1));
    actual = cands[0];
  }
  if (!actual) return e;
  const hits = e.tickets.map((t) => t.filter((n) => actual!.numbers.includes(n)).length);
  return {
    ...e,
    status: 'done',
    ky: actual.ky,
    actual: actual.numbers.slice(),
    hits,
    meanHits: avg(hits),
  };
}

export function configSignature(c: SolverConfig): string {
  return `LB${c.lookback}-H${c.hidden}-E${c.epochs}-K${c.tickets}-λ${c.lambda}`;
}

export interface ConfigAgg {
  config: SolverConfig;
  sig: string;
  n: number;
  meanHits: number | null;
  meanCoverage: number;
  meanObjective: number;
}

/** Tổng hợp theo phiên bản cấu hình — để so sánh "thuật toán nào tốt hơn". */
export function aggregateByConfig(entries: EvoEntry[]): ConfigAgg[] {
  const map = new Map<string, { config: SolverConfig; list: EvoEntry[] }>();
  for (const e of entries) {
    const sig = configSignature(e.config);
    if (!map.has(sig)) map.set(sig, { config: e.config, list: [] });
    map.get(sig)!.list.push(e);
  }
  const out: ConfigAgg[] = [];
  map.forEach(({ config, list }) => {
    const done = list.filter((e) => e.status === 'done' && e.meanHits !== null);
    out.push({
      config,
      sig: configSignature(config),
      n: list.length,
      meanHits: done.length > 0 ? avg(done.map((e) => e.meanHits!)) : null,
      meanCoverage: avg(list.map((e) => e.coverage)),
      meanObjective: avg(list.map((e) => e.totalScore)),
    });
  });
  out.sort((a, b) => b.meanObjective - a.meanObjective);
  return out;
}

/** Gợi ý cải tiến dựa trên dữ liệu đã đối chiếu. */
export function evolutionAdvice(entries: EvoEntry[]): string[] {
  const done = entries.filter((e) => e.status === 'done');
  const tips: string[] = [];
  if (done.length === 0) {
    tips.push('Chưa có bản ghi nào được đối chiếu — hãy chạy backtest vài kỳ để bắt đầu vòng lặp.');
    return tips;
  }
  const mh = avg(done.map((e) => e.meanHits!));
  const dev = Math.abs(mh - BASELINE_MEAN_HITS);
  if (dev < 0.15) {
    tips.push(
      `Hits TB ${mh.toFixed(2)} đang bám sát kỳ vọng ngẫu nhiên 0.65 (lệch ${dev.toFixed(2)}) — ` +
        'đây chính là "tiệm cận" của bài toán ngẫu nhiên: không cấu hình nào vượt qua được một cách bền vững.',
    );
  } else if (mh > BASELINE_MEAN_HITS) {
    tips.push(
      `Hits TB ${mh.toFixed(2)} đang cao hơn kỳ vọng ngẫu nhiên — nhưng với ${done.length} mẫu, ` +
        'hãy coi chừng nhiễu mẫu; cần thêm dữ liệu trước khi kết luận.',
    );
  }
  const aggs = aggregateByConfig(entries);
  if (aggs.length > 1) {
    const best = aggs[0];
    tips.push(
      `Theo objective (tổng điểm + λ·bao phủ), cấu hình tốt nhất hiện tại là ${best.sig} ` +
        `(objective TB ${best.meanObjective.toFixed(2)}, bao phủ TB ${best.meanCoverage.toFixed(1)}). ` +
        'Hãy ưu tiên dùng cấu hình này cho các gợi ý tiếp theo.',
    );
  }
  const covs = done.map((e) => e.coverage);
  const avgCov = avg(covs);
  const maxCov = Math.max(...covs);
  if (avgCov < maxCov - 1) {
    tips.push(
      `Độ bao phủ TB ${avgCov.toFixed(1)} còn dưới mức tốt nhất ${maxCov} — thử tăng λ lên 1 ` +
        'để solver ưu tiên đa dạng hóa danh mục vé.',
    );
  }
  return tips;
}
