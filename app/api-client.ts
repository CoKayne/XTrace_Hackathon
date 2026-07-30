export async function apiRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isFormData
      ? (init?.headers ?? {})
      : { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json() as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      body.error?.message ?? `Request failed: ${response.status}`,
    );
  }
  return body.data as T;
}
