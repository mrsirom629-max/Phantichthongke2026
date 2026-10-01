/**
 * Schema dữ liệu chuẩn — khớp mẫu Excel của người dùng:
 * Thứ | Ngày sổ | Miền | Giải | Tỉnh (mỗi tỉnh một cột, mỗi giải một hàng)
 */
export type Mien = 'nam' | 'trung' | 'bac';

/** Bộ giải thưởng của một đài (tỉnh) trong một ngày. */
export interface PrizeSet {
  /** Giải đặc biệt — 6 chữ số */
  db: string[];
  /** Giải nhất — 5 chữ số */
  nhat: string[];
  /** Giải nhì — 5 chữ số */
  nhi: string[];
  /** Giải ba — 5 chữ số (2 giải) */
  ba: string[];
  /** Giải tư — 5 chữ số (7 giải) */
  tu: string[];
  /** Giải năm — 4 chữ số */
  nam: string[];
  /** Giải sáu — 4 chữ số (3 giải) */
  sau: string[];
  /** Giải bảy — 3 chữ số */
  bay: string[];
  /** Giải tám — 2 chữ số */
  tam: string[];
}

export interface ProvinceResult {
  /** Tên tỉnh, ví dụ "Đồng Nai" */
  province: string;
  /** Mã đài, ví dụ "XSDN" */
  code: string;
  prizes: PrizeSet;
}

export interface DayResult {
  /** Ngày sổ: "DD-MM-YYYY", ví dụ "30-09-2026" */
  date: string;
  /** Thứ: "Thứ hai" ... "Chủ nhật" */
  weekday: string;
  mien: Mien;
  provinces: ProvinceResult[];
}

/** Thống kê tần suất một số lô tô (2 chữ số cuối). */
export interface NumberStat {
  /** Số có 2 chữ số, ví dụ "87" */
  number: string;
  count: number;
  /** Ngày xuất hiện gần nhất (DD-MM-YYYY) hoặc null */
  lastSeen: string | null;
  /** Số ngày vắng mặt tính đến hiện tại (lô gan) hoặc null */
  gapDays: number | null;
}

export interface StatsResult {
  /** Khoảng ngày tính toán */
  from: string;
  to: string;
  province: string; // "all" hoặc tên tỉnh
  /** Tần suất 00–99, sắp xếp theo số */
  freq: NumberStat[];
  /** Top số về nhiều nhất */
  hot: NumberStat[];
  /** Top số về ít nhất */
  cold: NumberStat[];
  /** Top số lâu chưa về (gan) */
  gan: NumberStat[];
  totalDraws: number;
}

/** Thứ tự giải để render bảng theo mẫu Excel (từ thấp đến cao). */
export const PRIZE_ORDER: { key: keyof PrizeSet; label: string }[] = [
  { key: 'tam', label: 'Giải tám' },
  { key: 'bay', label: 'Giải bảy' },
  { key: 'sau', label: 'Giải sáu' },
  { key: 'nam', label: 'Giải năm' },
  { key: 'tu', label: 'Giải tư' },
  { key: 'ba', label: 'Giải ba' },
  { key: 'nhi', label: 'Giải nhì' },
  { key: 'nhat', label: 'Giải nhất' },
  { key: 'db', label: 'Giải Đặc Biệt' },
];
