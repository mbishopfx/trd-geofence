export const DEFAULT_API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "https://trd-geofence-production.up.railway.app";

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }
  return trimmed.replace(/\/+$/, "");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  apiBaseUrl: string = DEFAULT_API_BASE_URL
): Promise<T> {
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const url = isAbsolutePath(path) ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        (body && (body.error || body.message || (Array.isArray(body.errors) ? body.errors.join(" ") : null))) ||
        `Request failed (${response.status})`;
      throw new Error(message);
    }

    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}
