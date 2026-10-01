/**
 * Đối chiếu mô phỏng với kết quả thật — chỉ chạy phía server.
 *
 * NGUYÊN TẮC: chỉ đối chiếu với số liệu LIVE từ Minh Ngọc.
 * Nếu chưa lấy được số thật (chưa quay / lỗi mạng) → giữ pending,
 * KHÔNG đối chiếu với dữ liệu mẫu, KHÔNG đoán kết quả (A19).
 */
import { fetchDayDetailed, fetchLive, type FetchDetail } from './minhngoc';
import { cmpDate, todayVN } from './stats';
import { entryMien, scoreForecast, truthLotoSet, type ForecastEntry } from './forecast';

/**
 * Đối chiếu một entry pending với kết quả thật của targetDate (đúng miền).
 * Trả về entry đã cập nhật, hoặc null khi chưa đối chiếu được.
 *
 * Thứ tự nguồn (sớm nhất trước):
 *  1. Trang TRỰC TIẾP — nếu targetDate là hôm nay (có số ngay khi đang quay,
 *     XSMN ~16:15–16:35, XSMB ~18:15–18:30). Chỉ nhận khi đủ 100% số liệu,
 *     thiếu là giữ pending để tick cron tiếp theo thử lại.
 *  2. Trang lưu trữ theo ngày — cho ngày quá khứ hoặc khi live chưa xong.
 */
export async function reconcileOne(entry: ForecastEntry): Promise<ForecastEntry | null> {
  if (entry.status !== 'pending') return null;
  const today = todayVN();
  if (cmpDate(entry.targetDate, today) > 0) return null; // ngày mục tiêu còn ở tương lai

  const mien = entryMien(entry);
  let d: FetchDetail | null = null;

  if (entry.targetDate === today) {
    const live = await fetchLive(mien);
    if (live.stage === 'ok' && live.data && live.data.date === entry.targetDate) {
      d = live;
    }
    // stage 'incomplete' → quay chưa xong: KHÔNG dùng số thiếu, thử trang lưu trữ
  }

  if (!d) {
    const arch = await fetchDayDetailed(entry.targetDate, mien);
    if (arch.stage !== 'ok' || !arch.data) return null; // chưa có số thật → giữ pending
    d = arch;
  }

  const truth = truthLotoSet(d.data!);
  if (truth.size === 0) return null;
  const metrics = scoreForecast(entry.numbers, truth);
  return {
    ...entry,
    status: 'reconciled',
    reconciledAt: new Date().toISOString(),
    metrics,
  };
}
