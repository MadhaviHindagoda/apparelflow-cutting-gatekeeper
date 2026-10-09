import { useEffect, useState } from 'react';
import Modal from './Modal';
import { StatusBadge, TrafficBadge } from './StatusBadge';
import { api } from '../api/client';
import { fmtDate } from '../lib/format';

export default function OrderDetailModal({ orderId, onClose }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/orders/${orderId}`)
      .then((d) => { if (!cancelled) setOrder(d.order); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [orderId]);

  return (
    <Modal
      title={order ? `Order ${order.order_no}` : 'Order details'}
      onClose={onClose}
      wide
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {!order && !error && <p role="status">Loading…</p>}

      {order && (
        <>
          <p>
            <StatusBadge status={order.status} /> &nbsp;
            <strong>{order.recipe_code}</strong> {order.recipe_name} · {order.target_qty} garments · created {fmtDate(order.created_at)}
          </p>

          {order.status === 'REJECTED' && (
            <p className="alert alert-error">Rejection reason: {order.last_rejection_note || 'none recorded'}</p>
          )}

          <div className="preview-metrics" style={{ marginBottom: '1rem' }}>
            <div><span className="metric-label">Fabric roll</span><span className="metric-value">{order.fabric_roll_id}</span></div>
            <div><span className="metric-label">Fabric used</span><span className="metric-value">{order.actual_fabric_yds} yds</span></div>
            <div><span className="metric-label">Expected fabric</span><span className="metric-value">{order.expected_fabric_yds} yds</span></div>
            <div><span className="metric-label">Wastage (cap {order.wastage_cap}%)</span><span className="metric-value">{order.wastage_pct}%</span></div>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="num">Expected</th>
                  <th className="num">Counted</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.component_name}>
                    <td>{i.component_name}</td>
                    <td className="num">{i.expected_qty}</td>
                    <td className="num">{i.actual_qty ?? '—'}</td>
                    <td><TrafficBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}