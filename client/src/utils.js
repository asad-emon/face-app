const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

// Keep the client usable without a VITE_API_BASE_URL value. In development,
// Vite proxies /api to the local API server; in production, nginx does the
// same, so the browser never needs to guess an API hostname or port.
export const apiBaseUrl = (
  configuredApiBaseUrl || "/api"
).replace(/\/+$/, "");
