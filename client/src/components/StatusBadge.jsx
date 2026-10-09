import '../ui.css';

const ORDER_STATUS = {
  IN_PROGRESS: ['In Progress', 'gray'],
  PENDING_VERIFICATION: ['Pending Verification', 'yellow'],
  REJECTED: ['Rejected', 'red'],
  VERIFIED: ['Verified', 'green'],
  SEWING_STARTED: ['Sewing Started', 'blue'],
};

export function StatusBadge({ status }) {
  const [label, colour] = ORDER_STATUS[status] || [status, 'gray'];
  return <span className={`badge badge-${colour}`}>{label}</span>;
}

// Traffic light. The text is always shown too, so colour is never the only signal.
const LIGHT = {
  GREEN: ['GREEN · Match', 'green'],
  YELLOW: ['YELLOW · Excess', 'yellow'],
  RED: ['RED · Shortage', 'red'],
};

export function TrafficBadge({ status }) {
  const [label, colour] = LIGHT[status] || ['Not counted', 'gray'];
  return <span className={`badge badge-${colour}`}>{label}</span>;
}