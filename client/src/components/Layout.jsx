import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DEMO_USERS, ROLE_HOME, ROLE_LABELS, ROLE_NAV } from '../roles';

export default function Layout() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');

  // Evaluator convenience: jump straight to another persona
  async function switchTo(demo) {
    if (demo.role === user.role || switching) return;
    setSwitching(true);
    setSwitchError('');
    try {
      const u = await login(demo.email, demo.password);
      navigate(ROLE_HOME[u.role], { replace: true });
    } catch (err) {
      setSwitchError(err.message);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">ApparelFlow <span>Cutting Gatekeeper</span></div>
          <div className="user-box">
            <span className="user-name">{user.full_name}</span>
            <span className="role-pill">{ROLE_LABELS[user.role]}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>Log out</button>
          </div>
        </div>

        <div className="topbar-row">
          <nav aria-label="Main">
            {(ROLE_NAV[user.role] || []).map((item) => (
              <NavLink key={item.to} to={item.to} className="nav-link">{item.label}</NavLink>
            ))}
          </nav>

          <div className="switcher" aria-label="Demo role switcher">
            <span className="switcher-label">Switch role:</span>
            {DEMO_USERS.map((d) => (
              <button
                key={d.role}
                type="button"
                className={`btn btn-sm ${d.role === user.role ? 'btn-active' : 'btn-secondary'}`}
                onClick={() => switchTo(d)}
                disabled={switching}
                aria-pressed={d.role === user.role}
              >
                {ROLE_LABELS[d.role]}
              </button>
            ))}
          </div>
        </div>
        {switchError && <p className="field-error" role="alert">{switchError}</p>}
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}