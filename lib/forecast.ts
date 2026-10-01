/**
 * Vòng lặp dự báo → nhật ký → đối chiếu → cải tiến liên tục ("mức độ tiên hóa").
 *
 * Nguyên tắc audit được áp dụng (từ TRADE2026_AUDIT_KAIZEN_HANDOFF):
 * - Journal ghi snapshot TRƯỚC khi outcome xuất hiện; cấm backfill dự báo
 *   vào sự kiện cũ (A19).
 * - Kỷ luật thời gian: mô phỏng chỉ dùng dữ liệu trước ngày mục tiêu (A04/A07).
 * - Đánh giá trung thực kèm baseline trên cùng tập truth (A05); điểm số mô
 *   hình CHƯA hiệu chuẩn, không gọi là "xác suất trúng".
 * - Mô hình mới chạy ở chế độ shadow: chỉ ghi nhận để đo lường.
 *
 * Module này thuần túy (client & server đều dùng được).
 */
import type { DayResult } from './types';
import { lotoOf } from './stats';

export type ForecastModel = 'mlp' | 'freq';

export interface ForecastParams {
  lookback: number;
  hidden: number;
  epochs: number;
  lr: number;
  seed: number;
}

export interface ForecastDataRange {
  from: string; // DD-MM-YYYY
  to: string; // DD-MM-YYYY (ngày dữ liệu mới nhất, < targetDate)
  days: number;
  live: number; // số ngày live Minh Ngọc
  seed: number; // số ngày dùng mẫu
}

export interface ForecastMetrics {
  hits: number;
  precision: number; // hits / k
  recall: number; // hits / truthSize
  truthSize: number; // số lô tô phân biệt thật trong ngày
  baselinePrecision: number; // kỳ vọng của đoán ngẫu nhiên = truthSize / 100
}

export interface ForecastEntry {
  id: string;
  createdAt: string; // ISO
  targetDate: string; // DD-MM-YYYY — ngày được mô phỏng
  model: ForecastModel;
  modelVersion: string;
  mode: 'shadow'; // luôn shadow: chỉ ghi nhận để đo lường
  k: number;
  params: ForecastParams;
  dataRange: ForecastDataRange;
  numbers: string[]; // top-k theo thứ hạng mô hình, "00".."99"
  status: 'pending' | 'reconciled';
  reconciledAt?: string; // ISO
  metrics?: ForecastMetrics;
  note?: string;
}

export const MODEL_VERSIONS: Record<ForecastModel, string> = {
  mlp: 'mlp-100-h-100-sigmoid-xavier-bce-sgd-v1',
  freq: 'freq-topk-v1',
};

export const MODEL_LABELS: Record<ForecastModel, string> = {
  mlp: 'MLP (mạng nơ-ron)',
  freq: 'Tần suất (baseline)',
};

/** Tập lô tô phân biệt trong một ngày (2 chữ số cuối mọi giải, mọi đài). */
export function truthLotoSet(day: DayResult): Set<string> {
  const s = new Set<string>();
  for (const p of day.provinces) {
    for (const n of lotoOf(p.prizes)) s.add(n);
  }
  return s;
}

/** Chấm điểm một mô phỏng trước tập truth. */
export function scoreForecast(numbers: string[], truth: Set<string>): ForecastMetrics {
  const k = numbers.length;
  const hits = numbers.filter((n) => truth.has(n)).length;
  return {
    hits,
    precision: k > 0 ? hits / k : 0,
    recall: truth.size > 0 ? hits / truth.size : 0,
    truthSize: truth.size,
    baselinePrecision: truth.size / 100,
  };
}

/** Kỳ vọng precision@k khi đoán ngẫu nhiên k số phân biệt. */
export function randomBaselinePrecision(truthSize: number): number {
  return truthSize / 100;
}

export function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function fmtNum(n: string): string {
  return n.padStart(2, '0');
}
