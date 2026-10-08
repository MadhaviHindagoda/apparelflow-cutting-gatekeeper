// Pure functions (no DB, no Express) so they are trivial to unit test.

// 50 garments x 2 cuffs = 100 expected cuffs
function expectedComponentQty(targetQty, piecesPerGarment) {
  return targetQty * piecesPerGarment;
}

// Expected fabric (yards) = target qty x std yards per piece
function expectedFabricYards(targetQty, stdFabricYards) {
  return Number((targetQty * Number(stdFabricYards)).toFixed(3));
}

// Wastage % = ((actual - expected) / expected) x 100, rounded to 2 decimals
function wastagePct(actualYards, expectedYards) {
  if (!(expectedYards > 0)) throw new Error('Expected fabric must be > 0');
  return Number((((Number(actualYards) - expectedYards) / expectedYards) * 100).toFixed(2));
}

// Traffic light. actual === null/undefined means "not counted yet" => null (never GREEN).
function trafficLight(expected, actual) {
  if (actual === null || actual === undefined) return null;
  if (actual === expected) return 'GREEN';
  if (actual > expected) return 'YELLOW';
  return 'RED';
}

// The gatekeeper decision, derived ONLY from expected/actual numbers
// (never from a status value supplied by a client or even stored earlier).
function summarize(items) {
  const total = items.length;
  const uncounted = items.filter((i) => i.actual_qty === null || i.actual_qty === undefined);
  const red = items.filter((i) => trafficLight(i.expected_qty, i.actual_qty) === 'RED');
  return {
    total,
    counted: total - uncounted.length,
    uncounted_count: uncounted.length,
    red_count: red.length,
    has_red: red.length > 0,
    can_approve: total > 0 && uncounted.length === 0 && red.length === 0,
  };
}

module.exports = {
  expectedComponentQty,
  expectedFabricYards,
  wastagePct,
  trafficLight,
  summarize,
};