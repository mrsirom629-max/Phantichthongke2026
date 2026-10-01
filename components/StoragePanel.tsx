'use client';
/**
 * Panel dung lượng & backend lưu trữ.
 * - redis:  Upstash Redis — free 256MB, ghi không tạo commit/deploy.
 * - github: file JSON trong repo — giới hạn thực tế ~1MB/file,
 *           mỗi lần ghi = 1 commit → Vercel deploy lại toàn bộ.
 */
import { useEffect, useState } from 'react';

const LIMITS: Record<string, { bytes: number; label: string }> = {
  redis: { bytes: 256 * 1024 * 1024, label: 'Upstash Redis (free 256 MB)' },
  github: { bytes: 1024 * 1024, label: 'File trong GitHub repo (≈1 MB/file)' },
  file: { bytes: 1024 * 1024, label: 'File local (dev)' },
};
const WARN_RATIO = 0.7;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtLimit(n: number): string {
  return n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} MB` : `${Math.round(n / 1024)} KB`;
}

function statusOf(bytes: number, limit: number): 'ok' | 'warn' | 'critical' {
  const r = bytes / limit;
  if (r >= 1) return 'critical';
  if (r >= WARN_RATIO) return 'warn';
  return 'ok';
}

interface FileStat {
  name: string;
  desc: string;
  bytes: number;
}

export default function StoragePanel({ refreshKey }: { refreshKey?: number | string }) {
  const [files, setFiles] = useState<FileStat[] | null>(null);
  const [backend, setBackend] = useState<string>('github');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [mdN, mdB, fc] = await Promise.all([
          fetch('/api/masterdata?mien=nam').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/masterdata?mien=bac').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/forecast').then((r) => (r.ok ? r.json() : null)),
        ]);
        if (!alive) return;
        const enc = new TextEncoder();
        const stats: FileStat[] = [];
        if (mdN) {
          if (mdN.backend) setBackend(mdN.backend);
          stats.push({
            name: 'masterdata Miền Nam',
            desc: `${mdN.count ?? 0} ngày`,
            bytes: enc.encode(JSON.stringify(mdN.days ?? [])).length,
          });
        }
        if (mdB) {
          if (mdB.backend) setBackend(mdB.backend);
          stats.push({
            name: 'masterdata Miền Bắc',
            desc: `${mdB.count ?? 0} ngày`,
            bytes: enc.encode(JSON.stringify(mdB.days ?? [])).length,
          });
        }
        if (fc) {
          if (fc.backend) setBackend(fc.backend);
          const entries = fc.entries ?? [];
          stats.push({
            name: 'forecast-log (nhật ký mô phỏng)',
            desc: `${entries.length} mô phỏng`,
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

  const lim = LIMITS[backend] ?? LIMITS.github;
  const worst: 'ok' | 'warn' | 'critical' = files
    ? files.reduce<'ok' | 'warn' | 'critical'>((acc, f) => {
        const s = statusOf(f.bytes, lim.bytes);
        if (s === 'critical') return 'critical';
        if (s === 'warn' && acc === 'ok') return 'warn';
        return acc;
      }, 'ok')
    : 'ok';

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>Dung lượng lưu trữ</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Kho hiện tại: <b>{lim.label}</b>
      </p>

      {files ? (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Dữ liệu</th>
                <th>Nội dung</th>
                <th>Dung lượng</th>
                <th>Mức dùng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const st = statusOf(f.bytes, lim.bytes);
                const pct = Math.min(100, (f.bytes / lim.bytes) * 100);
                return (
                  <tr key={f.name}>
                    <td style={{ fontSize: 13 }}>{f.name}</td>
                    <td>{f.desc}</td>
                    <td className="num">{fmtBytes(f.bytes)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div className="progress" style={{ margin: 0 }}>
                        <div
                          style={{
                            width: `${Math.max(pct, 1.5)}%`,
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
                        {pct.toFixed(1)}% / {fmtLimit(lim.bytes)}
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

      {backend === 'github' && (
        <div className="note" style={{ marginTop: 12, borderLeft: '3px solid #f0a35e' }}>
          <b>⚠ Cảnh báo:</b> với kho file trong repo, mỗi lần ghi tạo <b>1 commit</b>{' '}
          → <b>Vercel deploy lại toàn bộ web</b>. Nên chuyển sang Upstash Redis
          (ghi không tạo commit, không deploy).
          {worst !== 'ok' && (
            <>
              {' '}
              Hiện tại dung lượng đã <b>{worst === 'warn' ? 'sắp đầy' : 'quá tải'}</b>{' '}
              — nên chuyển ngay.
            </>
          )}
        </div>
      )}

      {backend === 'redis' && (
        <div className="note" style={{ marginTop: 12, borderLeft: '3px solid #7ee2a8' }}>
          <b>✓ Kho Redis đang hoạt động:</b> ghi dữ liệu không tạo commit, không
          deploy lại. Dung lượng free 256 MB — với ~3 KB/ngày xổ số, đủ dùng hàng
          chục năm.
        </div>
      )}

      {backend === 'github' && (
        <div className="card" style={{ marginTop: 12, background: 'rgba(125,226,168,0.06)' }}>
          <h3 style={{ marginTop: 0 }}>Đề xuất: Upstash Redis (miễn phí)</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Tạo Redis miễn phí trên <b>upstash.com</b> (vùng Singapore) → thêm 2
            biến môi trường <code>UPSTASH_REDIS_REST_URL</code> và{' '}
            <code>UPSTASH_REDIS_REST_TOKEN</code> vào Vercel → Redeploy. Code đã hỗ
            trợ sẵn, chỉ cần bật biến là tự chuyển.
          </p>
        </div>
      )}
    </section>
  );
}
