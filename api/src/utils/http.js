import { API_BASE_URL } from "../config.js";

export function getApiBaseUrl(req) {
  if (API_BASE_URL) {
    return API_BASE_URL;
  }
  const host = req.get("host");
  if (!host) {
    return "";
  }
  return `${req.protocol}://${host}`;
}
