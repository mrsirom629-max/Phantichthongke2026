/**
 * Huấn luyện & dự báo cho vòng lặp mô phỏng (dùng được cả client lẫn server).
 * - Train trên TOÀN BỘ quá khứ trước ngày mục tiêu (không rò rỉ tương lai).
 * - Điểm số đầu ra CHƯA hiệu chuẩn: chỉ dùng để xếp hạng top-k,
 *   không diễn giải thành "xác suất trúng".
 */
import { MLP, buildDataset, lotoOfDay, topK } from './nn';
import { cmpDate } from './stats';
import type { DayResult } from './types';
import { fmtNum } from './forecast';

export interface TrainProgress {
  epoch: number;
  total: number;
  loss: number;
}

/** Huấn luyện chia chunk qua setTimeout → không đơ UI trên trình duyệt. */
export async function trainAsync(
  mlp: MLP,
  X: number[][],
  Y: number[][],
  epochs: number,
  lr: number,
  chunk: number,
  onProgress?: (p: TrainProgress) => void,
): Promise<void> {
  let done = 0;
  while (done < epochs) {
    const step = Math.min(chunk, epochs - done);
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        mlp.fit(X, Y, step, lr, (e, loss) =>
          onProgress?.({ epoch: done + e + 1, total: epochs, loss }),
        );
        resolve();
      }, 0);
    });
    done += step;
  }
}

/**
 * Vector đặc trưng cho "kỳ tiếp theo": tần suất tương đối của 100 số lô tô
 * trong `lookback` ngày gần nhất — đúng cách buildDataset dựng feature X.
 */
export function featureForNext(days: DayResult[], lookback: number): number[] {
  const sorted = days.slice().sort((a, b) => cmpDate(a.date, b.date));
  const lotos = sorted.map(lotoOfDay);
  const counts = new Array<number>(100).fill(0);
  let total = 0;
  const start = Math.max(0, lotos.length - lookback);
  for (let j = start; j < lotos.length; j++) {
    for (const n of lotos[j]) {
      counts[n]++;
      total++;
    }
  }
  return counts.map((c) => (total > 0 ? c / total : 0));
}

/** Dự báo top-k bằng MLP đã huấn luyện. Trả về ["00".."99"] theo thứ hạng. */
export function predictTopK(
  mlp: MLP,
  days: DayResult[],
  lookback: number,
  k: number,
): string[] {
  const scores = mlp.forward(featureForNext(days, lookback));
  return topK(scores, k).map((i) => fmtNum(String(i)));
}

/** Số lần xuất hiện của 100 số lô tô trong toàn bộ cửa sổ dữ liệu. */
export function freqCounts(days: DayResult[]): number[] {
  const counts = new Array<number>(100).fill(0);
  for (const d of days) for (const n of lotoOfDay(d)) counts[n]++;
  return counts;
}

/** Baseline tần suất: k số xuất hiện nhiều nhất trong cửa sổ dữ liệu. */
export function freqTopK(days: DayResult[], k: number): string[] {
  return topK(freqCounts(days), k).map((i) => fmtNum(String(i)));
}

/**
 * Huấn luyện trọn gói một mô hình MLP dự báo trên dữ liệu quá khứ.
 * Trả về mlp đã train xong (toàn bộ mẫu, không tách test — "test" là tương lai).
 */
export async function trainForecastMLP(
  days: DayResult[],
  lookback: number,
  hidden: number,
  epochs: number,
  lr: number,
  seed: number,
  onProgress?: (p: TrainProgress) => void,
): Promise<MLP> {
  const ds = buildDataset(days, lookback);
  if (ds.X.length === 0) throw new Error('Không đủ dữ liệu để dựng mẫu huấn luyện.');
  const mlp = new MLP([100, hidden, 100], seed);
  await trainAsync(mlp, ds.X, ds.Y, epochs, lr, 25, onProgress);
  return mlp;
}
