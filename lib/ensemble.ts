/**
 * Ensemble "Tất cả": kết hợp 3 mô hình (MLP, tần suất, đồ thị tri thức)
 * bằng Borda rank fusion.
 *
 * Mỗi mô hình cho điểm trên thang đo khác nhau (đầu ra sigmoid / số lần xuất
 * hiện / PageRank) nên không cộng trực tiếp được — thay vào đó mỗi mô hình
 * "bỏ phiếu" theo thứ hạng: hạng 1 được 100 điểm, hạng 2 được 99, ...,
 * hạng 100 được 1 điểm. Cộng điểm cả 3 mô hình, lấy top-k điểm cao nhất.
 *
 * Điểm số chỉ dùng để XẾP HẠNG, không phải xác suất trúng — xổ số là các kỳ
 * quay ngẫu nhiên độc lập.
 */
import type { MLP } from './nn';
import { featureForNext, freqCounts } from './forecastModel';
import { buildCooccurrenceGraph, pageRank } from './graph';
import { fmtNum } from './forecast';
import type { DayResult } from './types';

const N = 100;

/** Thứ hạng của từng số (0 = cao nhất); hòa điểm thì số nhỏ xếp trước. */
function ranksOf(scores: number[]): number[] {
  const order = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.i);
  const rank = new Array<number>(N);
  order.forEach((idx, r) => {
    rank[idx] = r;
  });
  return rank;
}

/**
 * Top-k ("00".."99") từ điểm Borda tổng hợp của 3 mô hình.
 * Nhận mlp ĐÃ train + dữ liệu quá khứ; tự tính điểm từng mô hình.
 */
export function ensembleTopK(
  mlp: MLP,
  days: DayResult[],
  lookback: number,
  k: number,
): string[] {
  const sMlp = mlp.forward(featureForNext(days, lookback));
  const sFreq = freqCounts(days);
  const sGraph = pageRank(buildCooccurrenceGraph(days));
  const rMlp = ranksOf(sMlp);
  const rFreq = ranksOf(sFreq);
  const rGraph = ranksOf(sGraph);
  const total = Array.from(
    { length: N },
    (_, i) => N - rMlp[i] + (N - rFreq[i]) + (N - rGraph[i]),
  );
  return total
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, Math.min(Math.max(k, 1), N))
    .map((x) => fmtNum(String(x.i)));
}
