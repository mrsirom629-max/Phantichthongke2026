/**
 * Đối chiếu mô phỏng với kết quả thật — chỉ chạy phía server.
 *
 * NGUYÊN TẮC: chỉ đối chiếu với số liệu LIVE từ Minh Ngọc.
 * Nếu chưa lấy được số thật (chưa quay / lỗi mạng) → giữ pending,
 * KHÔNG đối chiếu với dữ liệu mẫu, KHÔNG đoán kết quả (A19).
 */
import { fetchDayDetailed } from './minhngoc';
import { cmpDate, todayVN } from './stats';
import { entryMien, scoreForecast, truthLotoSet, type ForecastEntry } from './forecast';

/**
 * Đối chiếu một entry pending với kết quả thật của targetDate (đúng miền).
 * Trả về entry đã cập nhật, hoặc null khi chưa đối chiếu được.
 */
export async function reconcileOne(entry: ForecastEntry): Promise<ForecastEntry | null> {
  if (entry.status !== 'pending') return null;
  if (cmpDate(entry.targetDate, todayVN()) > 0) return null; // ngày mục tiêu còn ở tương lai

  const d = await fetchDayDetailed(entry.targetDate, entryMien(entry));
  if (d.stage !== 'ok' || !d.data) return null; // chưa có số thật → giữ pending

  const truth = truthLotoSet(d.data);
  if (truth.size === 0) return null;
  const metrics = scoreForecast(entry.numbers, truth);
  return {
    ...entry,
    status: 'reconciled',
    reconciledAt: new Date().toISOString(),
    metrics,
  };
}
