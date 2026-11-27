// What a Steimatzky shopper pays. A row's `price` is the list price; the campaign price sits in the format label the
// store's card prints (specialLabel.printed / .digital), and in salePrice on rows without a label. On 26.11 (Black
// Friday) 18,589 live rows had a list price above the store's price: the concierge showed ₪93.60 for a ₪50 book and
// "עד 30" searches dropped the books that had come down to 30.
const number = value => { const n = Number(value && typeof value === 'object' ? value.value : value); return Number.isFinite(n) && n > 0 ? n : null; };
const tail = row => String(row?.sku || row?.id || row?._id || '').split(':').pop();

// The two prices as the row states them. The store's card template reads `price` as the list price (crossed out beside
// salePrice on a sale), so a search answers with these while it filters and ranks by what the shopper pays.
export const listPrices = row => ({price: number(row?.price), regularPrice: number(row?.regularPrice ?? row?.regular_price)});

export function storePrice(row) {
  const list = number(row?.price);
  const label = row?.specialLabel?.type === 'book_formats' ? row.specialLabel : null;
  if (label) {
    // A printed and a digital edition are two rows with one label; the digital row is the one the label names.
    const digital = !!label.digital?.sku && String(label.digital.sku) === tail(row);
    const own = digital ? label.digital : label.printed;
    const price = own && own.enabled !== false ? number(own.value) : null;
    if (price !== null) {
      // The list price on a digital row is the printed book's: only the label knows the e-book's own.
      const regular = number(own.regular) ?? (digital ? null : list);
      return {price, regularPrice: regular !== null && regular > price ? regular : null};
    }
  }
  const sale = row?.onSale === false ? null : number(row?.salePrice);
  if (sale !== null && list !== null && sale < list) return {price: sale, regularPrice: list};
  const regular = number(row?.regularPrice ?? row?.regular_price);
  return {price: list, regularPrice: regular !== null && list !== null && regular > list ? regular : null};
}
