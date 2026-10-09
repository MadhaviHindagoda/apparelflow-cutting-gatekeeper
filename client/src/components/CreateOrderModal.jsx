import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import Field from './Field';
import { api, ApiError } from '../api/client';
import { validateQty, validateRecipe, validateRoll, validateYards } from '../lib/validate';
import { round } from '../lib/format';

// Maps the server's field names to this form's field names
const SERVER_FIELDS = {
  recipe_id: 'recipeId',
  target_qty: 'qty',
  fabric_roll_id: 'roll',
  actual_fabric_yds: 'yards',
};

export default function CreateOrderModal({ onClose, onCreated }) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState({ recipeId: '', qty: '', roll: '', yards: '' });
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/recipes')
      .then((d) => { if (!cancelled) setRecipes(d.recipes); })
      .catch((e) => { if (!cancelled) setLoadError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const errors = useMemo(
    () => ({
      recipeId: validateRecipe(form.recipeId),
      qty: validateQty(form.qty),
      roll: validateRoll(form.roll),
      yards: validateYards(form.yards),
    }),
    [form]
  );
  const hasErrors = Object.values(errors).some(Boolean);

  function setField(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
    setServerErrors((s) => ({ ...s, [name]: undefined }));
    setFormError('');
  }
  const blur = (name) => setTouched((t) => ({ ...t, [name]: true }));

  // Show an error as soon as the user has typed something wrong, or after they leave the field
  function fieldError(name) {
    if (serverErrors[name]) return serverErrors[name];
    const hasValue = form[name].trim() !== '';
    return touched[name] || hasValue ? errors[name] : '';
  }

  // ---- Live multiplier engine (preview only; the server recomputes everything) ----
  const recipe = recipes.find((r) => String(r.id) === form.recipeId);
  const qtyValid = form.qty.trim() !== '' && !errors.qty;
  const qty = qtyValid ? Number(form.qty) : null;
  const yardsValid = form.yards.trim() !== '' && !errors.yards;
  const yards = yardsValid ? Number(form.yards) : null;

  const expectedFabric = recipe && qty ? round(qty * recipe.std_fabric_yards, 3) : null;
  const wastage = expectedFabric && yards !== null ? round(((yards - expectedFabric) / expectedFabric) * 100, 2) : null;

  async function submit(e) {
    e.preventDefault();
    setTouched({ recipeId: true, qty: true, roll: true, yards: true });
    if (hasErrors) return;

    setSubmitting(true);
    setFormError('');
    try {
      const data = await api.post('/api/orders', {
        recipe_id: Number(form.recipeId),
        target_qty: Number(form.qty),
        fabric_roll_id: form.roll.trim(),
        actual_fabric_yds: Number(form.yards),
      });
      onCreated(data.order);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        const mapped = {};
        for (const [k, msg] of Object.entries(err.fields)) {
          if (SERVER_FIELDS[k]) mapped[SERVER_FIELDS[k]] = msg;
        }
        setServerErrors(mapped);
        setFormError('Please correct the highlighted fields.');
      } else {
        setFormError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Create Cutting Order"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="create-order-form"
            className="btn btn-primary"
            disabled={submitting || loading || Boolean(loadError)}
          >
            {submitting ? 'Submitting…' : 'Submit for Verification'}
          </button>
        </>
      }
    >
      {loading && <p role="status">Loading recipes…</p>}
      {loadError && <p className="alert alert-error" role="alert">{loadError}</p>}

      {!loading && !loadError && (
        <form id="create-order-form" noValidate onSubmit={submit}>
          {formError && <p className="alert alert-error" role="alert">{formError}</p>}

          <Field id="recipe" label="Recipe" error={fieldError('recipeId')}>
            <select
              id="recipe"
              value={form.recipeId}
              onChange={(e) => setField('recipeId', e.target.value)}
              onBlur={() => blur('recipeId')}
              aria-invalid={Boolean(fieldError('recipeId'))}
              aria-describedby={fieldError('recipeId') ? 'recipe-error' : undefined}
            >
              <option value="">Select a recipe…</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.recipe_code} — {r.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="form-grid">
            <Field id="qty" label="Target batch quantity (garments)" error={fieldError('qty')} hint="Whole number, e.g. 50">
              <input
                id="qty"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.qty}
                onChange={(e) => setField('qty', e.target.value)}
                onBlur={() => blur('qty')}
                aria-invalid={Boolean(fieldError('qty'))}
                aria-describedby={fieldError('qty') ? 'qty-error' : 'qty-hint'}
              />
            </Field>

            <Field id="roll" label="Fabric roll ID" error={fieldError('roll')} hint="e.g. FAB-ROLL-882">
              <input
                id="roll"
                type="text"
                autoComplete="off"
                maxLength={60}
                value={form.roll}
                onChange={(e) => setField('roll', e.target.value)}
                onBlur={() => blur('roll')}
                aria-invalid={Boolean(fieldError('roll'))}
                aria-describedby={fieldError('roll') ? 'roll-error' : 'roll-hint'}
              />
            </Field>

            <Field id="yards" label="Actual fabric used (yards)" error={fieldError('yards')} hint="Up to 2 decimals, e.g. 94.5">
              <input
                id="yards"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.yards}
                onChange={(e) => setField('yards', e.target.value)}
                onBlur={() => blur('yards')}
                aria-invalid={Boolean(fieldError('yards'))}
                aria-describedby={fieldError('yards') ? 'yards-error' : 'yards-hint'}
              />
            </Field>
          </div>

          {recipe && (
            <section className="preview" aria-live="polite" aria-label="Expected component counts">
              <h3>Expected cut pieces{qty ? ` for ${qty} garments` : ''}</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th className="num">Pieces / garment</th>
                      <th className="num">Expected count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipe.components.map((c) => (
                      <tr key={c.id}>
                        <td>{c.component_name}</td>
                        <td className="num">{c.pieces_per_garment}</td>
                        <td className="num"><strong>{qty ? qty * c.pieces_per_garment : '—'}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="preview-metrics">
                <div>
                  <span className="metric-label">Standard fabric</span>
                  <span className="metric-value">{recipe.std_fabric_yards} yds / piece</span>
                </div>
                <div>
                  <span className="metric-label">Expected fabric</span>
                  <span className="metric-value">{expectedFabric !== null ? `${expectedFabric} yds` : '—'}</span>
                </div>
                <div>
                  <span className="metric-label">Wastage (cap {recipe.wastage_cap}%)</span>
                  <span className="metric-value">{wastage !== null ? `${wastage}%` : '—'}</span>
                </div>
              </div>

              {wastage !== null && wastage > recipe.wastage_cap && (
                <p className="alert alert-warn" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  Fabric wastage is above the {recipe.wastage_cap}% cap for this recipe. You can still submit; it will be
                  recorded for the verifier.
                </p>
              )}
            </section>
          )}
        </form>
      )}
    </Modal>
  );
}