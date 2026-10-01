/**
 * Mạng nơ-ron + Solver tối ưu cho Power 6/55.
 *
 * Kiến trúc "đấu nối" 2 tầng (theo hướng của người dùng):
 *   Tầng 1 — MẠNG NƠ-RON cho điểm: MLP 55→hidden→55 học từ lịch sử các kỳ,
 *            đầu ra là ĐIỂM SỐ MÔ TẢ cho từng số 01–55 (không phải xác suất).
 *   Tầng 2 — SOLVER TỐI ƯU: bài toán chọn K vé × 6 số sao cho tổng điểm lớn
 *            nhất + độ bao phủ cao nhất, dưới các ràng buộc tổ hợp
 *            (số lẻ, tổng, cặp liên tiếp). Giải bằng heuristic
 *            greedy + local search (tìm kiếm cục bộ).
 *
 * TRUNG THỰC: các kỳ quay độc lập ngẫu nhiên — NN không "thấy trước" được gì
 * (điểm số kỳ vọng ≈ đều + nhiễu). Solver KHÔNG làm tăng xác suất trúng;
 * nó chỉ giúp (1) giữ kỷ luật tổ hợp cân bằng, (2) đa dạng hóa danh mục vé,
 * (3) tránh dồn vào các số "được nhiều người chọn" (giảm chia giải NẾU trúng).
 */
import { MLP } from './nn';
import { trainAsync, type TrainProgress } from './forecastModel';
import type { PowerDraw } from './vietlott';
import { N55 } from './power655';

/* ── Tầng 1: dataset & huấn luyện NN ─────────────────────────── */

export interface Dataset55 {
  X: number[][];
  Y: number[][];
}

/**
 * Mẫu huấn luyện: X = tần suất chuẩn hóa của `lookback` kỳ trước
 * (55 chiều), Y = multi-hot 6 số của kỳ tiếp theo.
 */
export function buildDataset55(draws: PowerDraw[], lookback: number): Dataset55 {
  const key = (s: string) => s.split('-').reverse().join('');
  const sorted = draws.slice().sort((a, b) => (key(a.date) < key(b.date) ? -1 : 1));
  const X: number[][] = [];
  const Y: number[][] = [];
  for (let i = lookback; i < sorted.length; i++) {
    const counts = new Array(N55).fill(0);
    for (let j = i - lookback; j < i; j++)
      for (const n of sorted[j].numbers) counts[n - 1]++;
    X.push(counts.map((c) => c / (6 * lookback)));
    const y = new Array(N55).fill(0);
    for (const n of sorted[i].numbers) y[n - 1] = 1;
    Y.push(y);
  }
  return { X, Y };
}

export async function trainNN55(
  draws: PowerDraw[],
  lookback: number,
  hidden: number,
  epochs: number,
  onProgress?: (p: TrainProgress) => void,
): Promise<MLP> {
  const ds = buildDataset55(draws, lookback);
  if (ds.X.length < 5) throw new Error(`Chỉ tạo được ${ds.X.length} mẫu huấn luyện — cần thêm dữ liệu hoặc giảm lookback.`);
  const mlp = new MLP([N55, hidden, N55], 42);
  await trainAsync(mlp, ds.X, ds.Y, epochs, 0.5, 25, onProgress);
  return mlp;
}

/** Điểm số 55 số từ cửa sổ `lookback` kỳ gần nhất. */
export function scoreNumbers55(mlp: MLP, draws: PowerDraw[], lookback: number): number[] {
  const key = (s: string) => s.split('-').reverse().join('');
  const sorted = draws.slice().sort((a, b) => (key(a.date) < key(b.date) ? -1 : 1));
  const recent = sorted.slice(-lookback);
  const counts = new Array(N55).fill(0);
  for (const d of recent) for (const n of d.numbers) counts[n - 1]++;
  const x = counts.map((c) => c / (6 * Math.max(1, recent.length)));
  return mlp.forward(x);
}

/* ── Tầng 2: solver heuristic ────────────────────────────────── */

export interface TicketConstraints {
  oddMin: number;
  oddMax: number;
  sumMin: number;
  sumMax: number;
  consecMax: number;
}

export const DEFAULT_CONSTRAINTS: TicketConstraints = {
  oddMin: 2,
  oddMax: 4,
  sumMin: 100,
  sumMax: 250,
  consecMax: 2,
};

export interface Ticket {
  numbers: number[]; // 6 số tăng dần
  score: number; // tổng điểm NN
  odd: number;
  sum: number;
  consec: number;
}

export interface Portfolio {
  tickets: Ticket[];
  coverage: number; // số lượng số phân biệt bao phủ
  totalScore: number;
  lambda: number;
}

function consecCount(sorted: number[]): number {
  let c = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1] + 1) c++;
  return c;
}

function satisfies(nums: number[], c: TicketConstraints): boolean {
  if (nums.length !== 6 || new Set(nums).size !== 6) return false;
  const odd = nums.filter((n) => n % 2 === 1).length;
  const sum = nums.reduce((a, b) => a + b, 0);
  return (
    odd >= c.oddMin && odd <= c.oddMax &&
    sum >= c.sumMin && sum <= c.sumMax &&
    consecCount(nums.slice().sort((a, b) => a - b)) <= c.consecMax
  );
}

/** Ràng buộc từng phần khi đang greedy (còn có thể hoàn thiện được). */
function feasiblePartial(trial: number[], c: TicketConstraints): boolean {
  const len = trial.length;
  const odd = trial.filter((n) => n % 2 === 1).length;
  if (odd > c.oddMax || odd + (6 - len) < c.oddMin) return false;
  const sum = trial.reduce((a, b) => a + b, 0);
  if (sum > c.sumMax || sum + N55 * (6 - len) < c.sumMin) return false;
  if (consecCount(trial.slice().sort((a, b) => a - b)) > c.consecMax) return false;
  return true;
}

function objective(tickets: number[][], scores: number[], lambda: number): number {
  let s = 0;
  const covered = new Set<number>();
  for (const t of tickets)
    for (const n of t) {
      s += scores[n - 1];
      covered.add(n);
    }
  return s + lambda * covered.size;
}

function toTicket(nums: number[], scores: number[]): Ticket {
  const sorted = nums.slice().sort((a, b) => a - b);
  return {
    numbers: sorted,
    score: sorted.reduce((a, n) => a + scores[n - 1], 0),
    odd: sorted.filter((n) => n % 2 === 1).length,
    sum: sorted.reduce((a, b) => a + b, 0),
    consec: consecCount(sorted),
  };
}

/**
 * Solver: greedy xây dựng + local search cải tiến.
 * - lambda = trọng số ưu tiên BAO PHỦ (đa dạng hóa danh mục vé).
 */
export function solvePortfolio(
  scores: number[],
  ticketCount: number,
  lambda: number,
  c: TicketConstraints = DEFAULT_CONSTRAINTS,
): Portfolio {
  const K = Math.min(Math.max(Math.floor(ticketCount) || 1, 1), 10);
  const covered = new Set<number>();
  const tickets: number[][] = [];

  // 1. Greedy: từng vé chọn 6 số có lợi ích biên lớn nhất mà vẫn khả thi
  for (let t = 0; t < K; t++) {
    const order: number[] = Array.from({ length: N55 }, (_, i) => i + 1).sort(
      (a, b) =>
        scores[b - 1] + lambda * (covered.has(b) ? 0 : 1) -
        (scores[a - 1] + lambda * (covered.has(a) ? 0 : 1)),
    );
    const ticket: number[] = [];
    for (const n of order) {
      if (ticket.length >= 6) break;
      if (ticket.includes(n)) continue;
      const trial = [...ticket, n];
      if (feasiblePartial(trial, c)) ticket.push(n);
    }
    // Vá nếu greedy không đủ 6 số (hiếm): nới lỏng kiểm tra từng phần
    if (ticket.length < 6) {
      for (let n = 1; n <= N55 && ticket.length < 6; n++) {
        if (!ticket.includes(n)) ticket.push(n);
      }
    }
    for (const n of ticket) covered.add(n);
    tickets.push(ticket);
  }

  // 2. Local search: thử thay từng số bằng số khác nếu tốt hơn & thỏa ràng buộc
  let improved = true;
  let iter = 0;
  let best = objective(tickets, scores, lambda);
  while (improved && iter < 60) {
    improved = false;
    iter++;
    for (let t = 0; t < K && !improved; t++) {
      for (let p = 0; p < 6 && !improved; p++) {
        for (let n = 1; n <= N55; n++) {
          if (tickets[t].includes(n)) continue;
          const trial = tickets[t].slice();
          trial[p] = n;
          if (!satisfies(trial, c)) continue;
          const before = tickets[t];
          tickets[t] = trial;
          const val = objective(tickets, scores, lambda);
          if (val > best + 1e-9) {
            best = val;
            improved = true;
            break;
          }
          tickets[t] = before;
        }
      }
    }
  }

  const result = tickets.map((t) => toTicket(t, scores));
  const allNums = new Set<number>();
  for (const t of result) for (const n of t.numbers) allNums.add(n);
  return {
    tickets: result,
    coverage: allNums.size,
    totalScore: result.reduce((a, t) => a + t.score, 0),
    lambda,
  };
}

/** Thống kê phân tán điểm NN — độ lệch chuẩn nhỏ nghĩa là NN "không thấy gì". */
export function scoreSpread(scores: number[]): { mean: number; std: number; min: number; max: number } {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  return { mean, std: Math.sqrt(variance), min: Math.min(...scores), max: Math.max(...scores) };
}
