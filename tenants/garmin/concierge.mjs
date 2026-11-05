// Garmin's concierge stays closed on a part number: a shopper who types "010-04337-41H" knows exactly what they want,
// and the results (or their absence) answer it. Garmin part numbers are digit groups joined by hyphens, sometimes
// with a region letter at the end; at least five digits keeps model names like "HRM-600" or "Fenix-8" out.
export const isGarmin = store => store?.dbName === 'garmin';

export function looksLikeGarminSku(query) {
  const q = String(query || '').trim();
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(q) && (q.match(/\d/g) || []).length >= 5;
}
