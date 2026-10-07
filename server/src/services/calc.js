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

module.exports = { expectedComponentQty, expectedFabricYards, wastagePct };