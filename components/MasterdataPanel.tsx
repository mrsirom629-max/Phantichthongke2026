'use client';
/**
 * Bảng chi tiết masterdata: Thứ | Ngày | Số lô tô | SL | Nguồn | Ghi chú.
 * Dùng chung cho trang Thống kê và Lab mạng nơ-ron — chứng minh mỗi lần
 * loading đã ghi đúng, đủ, không trùng, không bỏ sót.
 */
import { weekdayOf } from '@/lib/constants';

export type MasterSource = 'minhngoc' | 'seed';

export interface MasterRow {
  date: string; // DD-MM-YYYY
  numbers: string[]; // lô tô phân biệt, đã sắp xếp
  source: MasterSource;
  isNew: boolean; // vừa được ghi trong lần load này
  upgraded?: boolean; // vừa được nâng cấp seed → live
}

export interface MasterSummary {
  totalMaster: number;
  masterFrom: string | null;
  masterTo: string | null;
  rangeFrom: string;
  rangeTo: string;
  rangeCount: number; // số ngày yêu cầu trong khoảng
  haveCount: number; // số ngày thực có
  added: number;
  upgraded: number;
  missing: string[]; // ngày thiếu trong khoảng (sau khi đã thử tải)
}

function weekdayOfDate(date: string): string {
  const [d, m, y] = date.split('-').map(Number);
  return weekdayOf(new Date(y, m - 1, d));
}

export default function MasterdataPanel({
  rows,
  summary,
}: {
  rows: MasterRow[];
  summary: MasterSummary;
}) {
  const complete = summary.missing.length === 0;
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>Masterdata — nhật ký ngày đã ghi</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Mỗi lần tải, hệ thống chỉ <b>ghi bổ sung những ngày chưa có</b> (ngày đã ghi
        không bao giờ bị ghi trùng; ngày mẫu được nâng cấp khi có số thật).
      </p>
      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="kpi-label">Tổng ngày trong masterdata</div>
          <div className="kpi-value">{summary.totalMaster}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Khoảng masterdata</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            {summary.masterFrom && summary.masterTo
              ? `${summary.masterFrom} → ${summary.masterTo}`
              : '—'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Lần ghi này: mới / nâng cấp</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            +{summary.added} / +{summary.upgraded}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Đủ trong khoảng tải</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            {summary.haveCount}/{summary.rangeCount}{' '}
            {complete ? (
              <span className="pill good">đủ</span>
            ) : (
              <span className="pill warn">thiếu {summary.missing.length}</span>
            )}
          </div>
        </div>
      </div>
      {!complete && (
        <p style={{ color: '#f0a35e', fontSize: 13, marginTop: 8 }}>
          Chưa có số liệu các ngày: {summary.missing.join(', ')} (có thể chưa tới giờ
          quay hoặc nguồn lỗi — sẽ tự bổ sung ở lần tải sau).
        </p>
      )}
      <div style={{ overflowX: 'auto', marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
        <table className="freq" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Thứ</th>
              <th>Ngày</th>
              <th>Số lô tô</th>
              <th>SL</th>
              <th>Nguồn</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td style={{ whiteSpace: 'nowrap' }}>{weekdayOfDate(r.date)}</td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.date}</td>
                <td
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  {r.numbers.join(' ')}
                </td>
                <td style={{ textAlign: 'center' }}>{r.numbers.length}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.source === 'minhngoc' ? (
                    <span className="pill good">trực tiếp</span>
                  ) : (
                    <span className="pill warn">mẫu</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {r.isNew ? (
                    <span style={{ color: '#7ee2a8' }}>vừa ghi mới</span>
                  ) : r.upgraded ? (
                    <span style={{ color: '#7ee2a8' }}>vừa nâng cấp</span>
                  ) : (
                    <span className="muted">đã có sẵn</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Khoảng vừa tải: {summary.rangeFrom} → {summary.rangeTo} • Số lô tô là các số
        2 chữ số phân biệt trong ngày (sắp xếp tăng dần).
      </p>
    </section>
  );
}
