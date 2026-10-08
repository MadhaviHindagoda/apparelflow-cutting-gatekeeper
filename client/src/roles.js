// UI convenience only. The REAL permission checks happen on the server (403).
export const ROLE_LABELS = {
  cutting_supervisor: 'Cutting Supervisor',
  cutting_verifier: 'Cutting Verifier',
  sewing_supervisor: 'Sewing Supervisor',
};

export const ROLE_HOME = {
  cutting_supervisor: '/supervisor',
  cutting_verifier: '/verifier',
  sewing_supervisor: '/sewing',
};

export const ROLE_NAV = {
  cutting_supervisor: [{ to: '/supervisor', label: 'Cutting Orders' }],
  cutting_verifier: [{ to: '/verifier', label: 'Verification Terminal' }],
  sewing_supervisor: [{ to: '/sewing', label: 'Sewing Queue' }],
};

// Shown on the login page and in the header role switcher (documented in README too)
export const DEMO_USERS = [
  { role: 'cutting_supervisor', email: 'supervisor@demo.com', password: 'Supervisor@123' },
  { role: 'cutting_verifier', email: 'verifier@demo.com', password: 'Verifier@123' },
  { role: 'sewing_supervisor', email: 'sewing@demo.com', password: 'Sewing@123' },
];