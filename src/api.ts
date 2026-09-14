export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const result = await response.json().catch(() => ({ error: 'Nieprawidłowa odpowiedź serwera.' }))
  if (!response.ok) throw new ApiError(result.error || 'Nie udało się wykonać operacji.', response.status)
  return result as T
}
