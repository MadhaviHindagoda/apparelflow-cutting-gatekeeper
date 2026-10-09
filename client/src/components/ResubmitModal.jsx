import { useState } from 'react';
import Modal from './Modal';
import Field from './Field';
import { api, ApiError } from '../api/client';
import { validateRoll, validateYards } from '../lib/validate';

export default function ResubmitModal({ order, onClose, onDone }) {
  const [roll, setRoll] = useState('');
  const [yards, setYards] = useState('');
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Both fields are optional: leave empty to keep the original values
  const errors = {
    roll: validateRoll(roll, { required: false }),
    yards: validateYards(yards, { required: false }),
  };
  const err = (name, value) => serverErrors[name] || (touched[name] || value.trim() !== '' ? errors[name] : '');

  async function submit(e) {
    e.preventDefault();
    setTouched({ roll: true, yards: true });
    if (errors.roll || errors.yards) return;

    const body = {};
    if (roll.trim()) body.fabric_roll_id = roll.trim();
    if (yards.trim()) body.actual_fabric_yds = Number(yards);

    setSubmitting(true);
    setFormError('');
    try {
      await api.post(`/api/orders/${order.id}/resubmit`, body);
      onDone(order);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 400 && e2.fields) {
        setServerErrors({ roll: e2.fields.fabric_roll_id, yards: e2.fields.actual_fabric_yds });
        setFormError('Please correct the highlighted fields.');
      } else {
        setFormError(e2.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Resubmit ${order.order_no}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="resubmit-form" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Resubmit for Verification'}
          </button>
        </>
      }
    >
      <div className="alert alert-error">
        Rejected by the verifier: {order.last_rejection_note || 'no reason recorded'}
      </div>
      <p className="muted">
        Confirm that the batch has been re-cut. The verifier must physically recount every component. Previous counts
        are cleared.
      </p>

      <form id="resubmit-form" noValidate onSubmit={submit}>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}
        <div className="form-grid">
          <Field id="rs-roll" label="New fabric roll ID (optional)" error={err('roll', roll)} hint={`Currently ${order.fabric_roll_id}`}>
            <input
              id="rs-roll"
              type="text"
              autoComplete="off"
              maxLength={60}
              value={roll}
              onChange={(e) => { setRoll(e.target.value); setServerErrors((s) => ({ ...s, roll: undefined })); }}
              onBlur={() => setTouched((t) => ({ ...t, roll: true }))}
              aria-invalid={Boolean(err('roll', roll))}
            />
          </Field>
          <Field id="rs-yards" label="New fabric used, yards (optional)" error={err('yards', yards)} hint={`Currently ${order.actual_fabric_yds} yds`}>
            <input
              id="rs-yards"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={yards}
              onChange={(e) => { setYards(e.target.value); setServerErrors((s) => ({ ...s, yards: undefined })); }}
              onBlur={() => setTouched((t) => ({ ...t, yards: true }))}
              aria-invalid={Boolean(err('yards', yards))}
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}