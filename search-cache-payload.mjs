// Preserve catalog-specific fields and ranking metadata; vectors are fetched separately.
export function compactSearchPayload(result) {
  if (!Array.isArray(result?.results)) return result;
  return { ...result, results: result.results.map(({ embedding, ...product }) => product) };
}

export function paginationTokenCategories(categories) {
  if (!categories) return categories;
  const { topProductEmbeddings, ...lightweight } = categories;
  return lightweight;
}
