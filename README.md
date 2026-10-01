# Thống kê XSMN theo mẫu

Web app thống kê kết quả xổ số miền Nam theo đúng mẫu bảng của bạn
(Thứ | Ngày sổ | Miền | Giải | Tỉnh), kèm module thống kê và **lab thực hành mạng nơ-ron**.

Dữ liệu kết quả: **minhngoc.net.vn** (lấy theo trang kết quả từng ngày, có cache, có fallback
dữ liệu mẫu offline).

## Chức năng

| Trang | Mô tả |
|---|---|
| `/` — Kết quả | Bảng đúng mẫu Excel: chọn ngày → hiện 9 hạng giải của từng đài, badge nguồn "Minh Ngọc trực tiếp" / "Dữ liệu mẫu (demo)" |
| `/thong-ke` — Thống kê | Tần suất 00–99 (lưới 10×10), top Hot / Cold / Gan theo số ngày và tỉnh tùy chọn |
| `/lab` — Lab mạng nơ-ron | MLP viết tay từ đầu (không thư viện), huấn luyện ngay trên trình duyệt, đánh giá precision@k/recall@k **so sánh với 2 baseline** (ngẫu nhiên, tần suất) |

> Lab có banner trung thực ngay đầu trang: xổ số là các kỳ quay ngẫu nhiên độc lập,
> không mô hình nào dự đoán được. Lab phục vụ học kỹ thuật mạng nơ-ron và phương pháp
> đánh giá đúng (train/test split theo thời gian, so sánh baseline) — đúng tinh thần tài liệu
> "Bản đồ kiến thức mạng nơ-ron AI".

## Cấu trúc

```
xs-thong-ke/
├── app/
│   ├── page.tsx            # Trang kết quả (mẫu Excel)
│   ├── thong-ke/page.tsx   # Trang thống kê
│   ├── lab/page.tsx        # Lab mạng nơ-ron
│   └── api/
│       ├── results/route.ts # GET ?date=DD-MM-YYYY → DayResult (live → fallback seed)
│       ├── stats/route.ts   # GET ?days=&province= → StatsResult (từ seed, nhanh)
│       └── days/route.ts    # GET → DayResult[] thô (cho lab)
├── lib/
│   ├── types.ts            # Schema dữ liệu chuẩn (contract chung)
│   ├── constants.ts        # Lịch quay XSMN theo thứ, cấu trúc giải
│   ├── minhngoc.ts         # Fetch + parse minhngoc.net.vn (cheerio, cache 30 phút)
│   ├── stats.ts            # Engine thống kê thuần túy (dùng được cả client)
│   └── nn.ts               # MLP from-scratch: forward/backprop, dataset, split
├── data/seed.json          # 90 ngày dữ liệu mẫu (sinh bởi script, có commit)
└── scripts/gen-seed.mjs    # Sinh seed deterministic: npm run seed
```

## Chạy local

```bash
npm install
npm run dev        # http://localhost:3000
```

Tạo lại dữ liệu mẫu (90 ngày, deterministic):

```bash
npm run seed
```

## Đẩy lên GitHub

```bash
cd xs-thong-ke
git init
git add .
git commit -m "Thống kê XSMN theo mẫu + lab mạng nơ-ron"
git branch -M main
git remote add origin https://github.com/<tài-khoản>/<tên-repo>.git
git push -u origin main
```

## Deploy lên Vercel

1. Vào [vercel.com](https://vercel.com) → **Add New → Project** → Import repo GitHub vừa push.
2. Framework Preset: **Next.js** (tự nhận). Không cần biến môi trường.
3. **Deploy** — xong, web chạy online ngay.

Lưu ý: API `/api/results` fetch trực tiếp minhngoc.net.vn phía server (có cache 30 phút,
mỗi request chỉ tải 1 trang, không spam). Nếu site nguồn chặn/bận, app tự dùng dữ liệu mẫu
và ghi rõ trên giao diện.

### Vòng lặp Dự báo → Nhật ký → Đối chiếu 17h30 (trang /du-bao)

- **Mô phỏng**: trang `/du-bao` train MLP (hoặc baseline tần suất) trên 90 ngày live,
  mô phỏng top-k số cho một ngày mục tiêu. Mọi mô phỏng chạy ở **chế độ shadow**
  (chỉ ghi nhận để đo lường), điểm số chưa hiệu chuẩn — không phải xác suất trúng.
- **Nhật ký**: mỗi mô phỏng được ghi vào `data/forecast-log.json` **trước** giờ quay
  (snapshot trước outcome; cấm backfill).
- **Đối chiếu 17h30**: Vercel Cron gọi `GET /api/reconcile` lúc 17:30 giờ VN mỗi ngày
  (`vercel.json`: `30 10 * * *` UTC). Job chỉ đối chiếu với số liệu **live** của ngày
  mục tiêu; chưa có số thật thì giữ pending.
- **Mức độ tiên hóa**: precision@k trung bình tích lũy theo mô hình, so với baseline
  đoán ngẫu nhiên — hiển thị tại `/du-bao`.

Để bật nhật ký chung + cron tự động trên Vercel, thêm Environment Variables:

| Biến | Ý nghĩa |
|---|---|
| `GITHUB_TOKEN` | Personal Access Token (classic) với quyền `repo` — để API ghi `data/forecast-log.json` về repo |
| `GITHUB_REPO` | (tùy chọn) `owner/repo`, mặc định `mrsirom629-max/Phantichthongke2026` |
| `CRON_SECRET` | (khuyến nghị) chuỗi bí mật — Vercel Cron tự gửi làm `Authorization: Bearer`, route từ chối request lạ |

Không có `GITHUB_TOKEN`: trang /du-bao vẫn chạy đầy đủ, nhật ký lưu tạm trên trình
duyệt (localStorage) và nút "Đối chiếu ngay" đối chiếu cục bộ khi có số thật.

## Nguồn dữ liệu & trách nhiệm

- Kết quả: `https://www.minhngoc.net.vn/ket-qua-xo-so/DD-MM-YYYY.html` (chỉ miền Nam).
- Số liệu trên web chỉ mang tính **thống kê mô tả**; xổ số là trò chơi may rủi,
  không phương pháp nào dự đoán được kết quả quay thưởng.
