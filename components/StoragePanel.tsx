'use client';
/**
 * Panel cảnh báo dung lượng lưu trữ.
 * Backend hiện tại: file JSON trong GitHub repo (qua Contents API).
 * - Mỗi file có giới hạn thực tế ~1MB (API base64).
 * - QUAN TRỌNG: mỗi lần ghi = 1 commit → Vercel deploy lại toàn bộ.
 */
import { useEffect, useState } from 'react';

const FILE_PRACTICAL_MAX = 1024 * 1024; // 1MB — ngưỡng thực tế cho GitHub Contents API
const WARN_RATIO = 0.7;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface FileStat {
  name: string;
  desc: string;
  bytes: number;
}

function statusOf(bytes: number): 'ok' | 'warn' | 'critical' {
  const r = bytes / FILE_PRACTICAL_MAX;
  if (r >= 1) return 'critical';
  if (r >= WARN_RATIO) return 'warn';
  return 'ok';
}

export default function StoragePanel({ refreshKey }: { refreshKey?: number | string }) {
  const [files, setFiles] = useState<FileStat[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [md, fc] = await Promise.all([
          fetch('/api/masterdata').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/forecast').then((r) => (r.ok ? r.json() : null)),
        ]);
        if (!alive) return;
        const enc = new TextEncoder();
        const stats: FileStat[] = [];
        if (md) {
          stats.push({
            name: 'data/masterdata.json',
            desc: `${md.count ?? 0} ngày đã ghi`,
            bytes: enc.encode(JSON.stringify(md.days ?? [])).length,
          });
        }
        if (fc) {
          const entries = fc.entries ?? [];
          stats.push({
            name: 'data/forecast-log.json',
            desc: `${entries.length} mô phỏng trong nhật ký`,
            bytes: enc.encode(JSON.stringify(entries)).length,
          });
        }
        setFiles(stats);
      } catch {
        /* giữ nguyên trạng thái cũ */
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const worst: 'ok' | 'warn' | 'critical' = files
    ? files.reduce<'ok' | 'warn' | 'critical'>(
        (acc, f) => {
          const s = statusOf(f.bytes);
          if (s === 'critical') return 'critical';
          if (s === 'warn' && acc === 'ok') return 'warn';
          return acc;
        },
        'ok',
      )
    : 'ok';

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>Dung lượng lưu trữ</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Kho hiện tại: <b>file JSON trong GitHub repo</b> (ghi qua API). Giới hạn
        thực tế mỗi file ≈ <b>1 MB</b>.
      </p>

      {files ? (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>File</th>
                <th>Nội dung</th>
                <th>Dung lượng</th>
                <th>Mức dùng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const st = statusOf(f.bytes);
                const pct = Math.min(100, (f.bytes / FILE_PRACTICAL_MAX) * 100);
                return (
                  <tr key={f.name}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                      {f.name}
                    </td>
                    <td>{f.desc}</td>
                    <td className="num">{fmtBytes(f.bytes)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div className="progress" style={{ margin: 0 }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            background:
                              st === 'critical'
                                ? '#f87171'
                                : st === 'warn'
                                  ? '#f0a35e'
                                  : undefined,
                          }}
                        />
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {pct.toFixed(1)}% / 1 MB
                      </div>
                    </td>
                    <td>
                      {st === 'ok' && <span className="pill good">ổn</span>}
                      {st === 'warn' && <span className="pill warn">sắp đầy</span>}
                      {st === 'critical' && <span className="pill bad">quá tải</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Đang đo dung lượng...</p>
      )}

      <div
        className="note"
        style={{ marginTop: 12, borderLeft: '3px solid #f0a35e' }}
      >
        <b>⚠ Cảnh báo quan trọng hơn dung lượng:</b> mỗi lần ghi vào kho hiện tại
        tạo <b>1 commit</b> lên GitHub → <b>Vercel deploy lại toàn bộ web</b>.
        Quét dữ liệu nhiều lần sẽ xếp hàng chục deploy như bạn đã thấy. Đây là lý
        do nên chuyển kho dữ liệu ra khỏi repo git.
        {worst !== 'ok' && (
          <>
            {' '}
            Hiện tại file đã <b>{worst === 'warn' ? 'sắp đầy' : 'quá tải'}</b> —
            nên chuyển ngay.
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 12, background: 'rgba(125,226,168,0.06)' }}>
        <h3 style={{ marginTop: 0 }}>Đề xuất: Upstash Redis (miễn phí)</h3>
        <ul style={{ fontSize: 13, lineHeight: 1.8, margin: '8px 0' }}>
          <li>
            <b>Free:</b> 10.000 lệnh/ngày • 256 MB lưu trữ — với ~3 KB/ngày xổ số,
            đủ dùng <b>hàng chục năm</b>.
          </li>
          <li>
            Ghi dữ liệu <b>không tạo commit, không deploy lại</b> — hết cảnh xếp
            hàng deploy.
          </li>
          <li>
            Đọc/ghi cả cục JSON như hiện tại → chuyển code rất ít (kho đã được
            trừu tượng sẵn).
          </li>
        </ul>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Cách làm: tạo Redis miễn phí trên <b>upstash.com</b> (hoặc Vercel →
          Storage → Upstash) → thêm 2 biến môi trường{' '}
          <code>UPSTASH_REDIS_REST_URL</code> và <code>UPSTASH_REDIS_REST_TOKEN</code>{' '}
          → báo tôi để chuyển backend. Lựa chọn khác: Supabase Postgres (free
          500 MB, chuẩn SQL nhưng phải tạo bảng).
        </p>
      </div>
    </section>
  );
}
