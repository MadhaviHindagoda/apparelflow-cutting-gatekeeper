// Usage: router.post('/x', authenticate, requireRole('cutting_verifier'), handler)
// 401 if not logged in, 403 if logged in with the wrong role.
const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  }
  next();
};

module.exports = requireRole;