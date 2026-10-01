/** Lịch quay XSMN theo thứ — dùng để biết ngày nào có đài nào. */
export const XSMN_SCHEDULE: Record<string, { province: string; code: string }[]> = {
  'Thứ hai': [
    { province: 'TP. HCM', code: 'XSHCM' },
    { province: 'Đồng Tháp', code: 'XSDT' },
    { province: 'Cà Mau', code: 'XSCM' },
  ],
  'Thứ ba': [
    { province: 'Bến Tre', code: 'XSBT' },
    { province: 'Vũng Tàu', code: 'XSVT' },
    { province: 'Bạc Liêu', code: 'XSBL' },
  ],
  'Thứ tư': [
    { province: 'Đồng Nai', code: 'XSDN' },
    { province: 'Cần Thơ', code: 'XSCT' },
    { province: 'Sóc Trăng', code: 'XSST' },
  ],
  'Thứ năm': [
    { province: 'Tây Ninh', code: 'XSTN' },
    { province: 'An Giang', code: 'XSAG' },
    { province: 'Bình Thuận', code: 'XSBTH' },
  ],
  'Thứ sáu': [
    { province: 'Vĩnh Long', code: 'XSVL' },
    { province: 'Bình Dương', code: 'XSBD' },
    { province: 'Trà Vinh', code: 'XSTV' },
  ],
  'Thứ bảy': [
    { province: 'TP. HCM', code: 'XSHCM' },
    { province: 'Long An', code: 'XSLA' },
    { province: 'Bình Phước', code: 'XSBP' },
    { province: 'Hậu Giang', code: 'XSHG' },
  ],
  'Chủ nhật': [
    { province: 'Tiền Giang', code: 'XSTG' },
    { province: 'Kiên Giang', code: 'XSKG' },
    { province: 'Đà Lạt', code: 'XSDL' },
  ],
};

/** Số lượng giải mỗi hạng mục (XSMN). */
export const PRIZE_COUNTS: Record<string, number> = {
  db: 1,
  nhat: 1,
  nhi: 1,
  ba: 2,
  tu: 7,
  nam: 1,
  sau: 3,
  bay: 1,
  tam: 1,
};

/** Độ dài chữ số mỗi hạng mục. */
export const PRIZE_DIGITS: Record<string, number> = {
  db: 6,
  nhat: 5,
  nhi: 5,
  ba: 5,
  tu: 5,
  nam: 4,
  sau: 4,
  bay: 3,
  tam: 2,
};

export const MINHNGOC_BASE = 'https://www.minhngoc.net.vn';
/** Trang kết quả theo ngày: /ket-qua-xo-so/DD-MM-YYYY.html */
export const dayUrl = (date: string) => `${MINHNGOC_BASE}/ket-qua-xo-so/${date}.html`;

/** Tên thứ trong tuần từ Date (giờ VN). */
export function weekdayOf(d: Date): string {
  const names = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  return names[d.getDay()];
}

/** "DD-MM-YYYY" từ Date. */
export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}
