import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import CreateOrderModal from '../components/CreateOrderModal';
import ResubmitModal from '../components/ResubmitModal';
import OrderDetailModal from '../components/OrderDetailModal';
import { fmtDate } from '../lib/format';
import '../ui.css';

export default function SupervisorPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { type: 'create' | 'detail' | 'resubmit', ... }
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/orders');
      setOrders(d.orders);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const counts = useMemo(() => {
    const c = {};
    for (const o of orders) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [orders]);

  const closeModal = () => setModal(null);

  return (
    <>
      <div className="page-head">
        <h1>Cutting Orders</h1>
        <div className="head-actions">
          <button type="button" className="btn btn-secondary" onClick={load}>Refresh</button>
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}>
            + New Cutting Order
          </button>
        </div>
      </div>

      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="stats" aria-label="Order totals">
        <span className="stat">Pending verification: {counts.PENDING_VERIFICATION || 0}</span>
        <span className="stat">Rejected: {counts.REJECTED || 0}</span>
        <span className="stat">Verified: {counts.VERIFIED || 0}</span>
        <span className="stat">Sewing started: {counts.SEWING_STARTED || 0}</span>
      </div>

      <section className="card">
        {loading ? (
          <p role="status">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="empty">No cutting orders yet. Create your first one with “New Cutting Order”.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Recipe</th>
                  <th className="num">Qty</th>
                  <th>Fabric roll</th>
                  <th className="num">Fabric (yds)</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <Fragment key={o.id}>
                    <tr>
                      <td><strong>{o.order_no}</strong></td>
                      <td>{o.recipe_code} · {o.recipe_name}</td>
                      <td className="num">{o.target_qty}</td>
                      <td>{o.fabric_roll_id}</td>
                      <td className="num">{o.actual_fabric_yds}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td>{fmtDate(o.created_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal({ type: 'detail', id: o.id })}>
                            View
                          </button>
                          {o.status === 'REJECTED' && (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'resubmit', order: o })}>
                              Resubmit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {o.status === 'REJECTED' && (
                      <tr className="note-row">
                        <td colSpan={8}>
                          <strong>Rejected by verifier:</strong> {o.last_rejection_note || 'no reason recorded'}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal?.type === 'create' && (
        <CreateOrderModal
          onClose={closeModal}
          onCreated={(order) => {
            closeModal();
            setNotice(`Order ${order.order_no} created and sent to the verifier.`);
            load();
          }}
        />
      )}
      {modal?.type === 'detail' && <OrderDetailModal orderId={modal.id} onClose={closeModal} />}
      {modal?.type === 'resubmit' && (
        <ResubmitModal
          order={modal.order}
          onClose={closeModal}
          onDone={(order) => {
            closeModal();
            setNotice(`Order ${order.order_no} resubmitted for verification.`);
            load();
          }}
        />
      )}
    </>
  );
}