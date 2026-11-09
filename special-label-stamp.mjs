// The /search responses are stamped with each product's stored specialLabel (fresh prices from Mongo). A store module
// may already have checked the label's formats against their own product rows and marked one sold out (Steimatzky:
// the printed edition of "פיתוי משעשע" is out of stock while its digital card is on sale). The stamp keeps that mark:
// the format stays off on the fresh label, and an offer badge that belongs to it goes with it. Any other label is
// stamped as stored.
export function stampedLabel(previous, stored) {
  if (!stored || typeof stored !== 'object' || !previous || typeof previous !== 'object') return stored;
  let next = stored;
  for (const format of ['printed', 'digital']) {
    if (!previous[format]?.soldOut || !next[format]?.enabled) continue;
    next = { ...next, [format]: { ...next[format], enabled: false, soldOut: true } };
    if (next.badge?.enabled && next.badge.value != null && next.badge.value === next[format].badge) next = { ...next, badge: { ...next.badge, enabled: false } };
  }
  return next;
}
