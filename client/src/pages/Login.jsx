import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DEMO_USERS, ROLE_HOME, ROLE_LABELS } from '../roles';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  async function doLogin(e, p) {
    setError('');
    if (!e.trim() || !p) {
      setError('Enter both email and password.');
      return;
    }
    setBusy(true);
    try {
      const u = await login(e.trim(), p);
      navigate(ROLE_HOME[u.role], { replace: true });
    } catch (err) {
      setError(err.status === 401 ? 'Invalid email or password.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <h1 className="login-title">ApparelFlow ERP</h1>
      <p className="login-sub">Cutting Operations &amp; Gatekeeper Verification Terminal</p>

      <div className="login-grid">
        <section className="card" aria-labelledby="signin-heading">
          <h2 id="signin-heading">Sign in</h2>
          <form
            noValidate
            onSubmit={(ev) => { ev.preventDefault(); doLogin(email, password); }}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
              />
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </section>

        <section className="card" aria-labelledby="demo-heading">
          <h2 id="demo-heading">Demo credentials</h2>
          <p className="muted">One click signs you in as that persona.</p>
          <ul className="demo-list">
            {DEMO_USERS.map((d) => (
              <li key={d.role} className="demo-item">
                <div>
                  <strong>{ROLE_LABELS[d.role]}</strong>
                  <div className="mono">{d.email}</div>
                  <div className="mono">{d.password}</div>
                </div>
                <div className="demo-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setEmail(d.email); setPassword(d.password); setError(''); }}
                  >
                    Fill
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => doLogin(d.email, d.password)}
                  >
                    Log in
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}