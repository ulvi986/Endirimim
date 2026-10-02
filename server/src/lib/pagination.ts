export type Pagination = { page: number; limit: number; offset: number }
export type Paginated<T> = {
  items: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean }
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export function parsePagination(query: { page?: unknown; limit?: unknown }, defaultLimit = DEFAULT_LIMIT): Pagination {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1))
  const requested = Math.trunc(Number(query.limit) || defaultLimit)
  const limit = Math.min(MAX_LIMIT, Math.max(1, requested))
  return { page, limit, offset: (page - 1) * limit }
}

export function paginate<T>(items: T[], total: number, { page, limit }: Pagination): Paginated<T> {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0
  return {
    items,
    pagination: { page, limit, total, totalPages, hasMore: page * limit < total },
  }
}
