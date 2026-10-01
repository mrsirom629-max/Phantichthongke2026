import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Thống kê XSMN theo mẫu',
  description:
    'Kết quả xổ số miền Nam theo mẫu bảng, thống kê tần suất và lab thực hành mạng nơ-ron. Dữ liệu: Minh Ngọc.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <header className="topbar">
          <div className="wrap topbar-inner">
            <a className="brand" href="/">
              Thống kê XSMN
            </a>
            <nav className="nav">
              <a href="/">Kết quả</a>
              <a href="/thong-ke">Thống kê</a>
              <a href="/lab">Lab mạng nơ-ron</a>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="footer">
          <div className="wrap">
            <p>
              Dữ liệu kết quả: <b>Minh Ngọc</b> (minhngoc.net.vn). Số liệu chỉ mang tính
              thống kê mô tả. Xổ số là trò chơi may rủi — không có phương pháp nào dự đoán
              được kết quả quay thưởng.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
