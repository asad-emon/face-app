export function parseRequestedVersion(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  const version = Number(rawValue);
  if (!Number.isInteger(version) || version <= 0) {
    return Number.NaN;
  }
  return version;
}

export function parseSetActive(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return true;
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  const value = String(rawValue).toLowerCase();
  if (value === "true" || value === "1" || value === "yes") {
    return true;
  }
  if (value === "false" || value === "0" || value === "no") {
    return false;
  }
  return true;
}

export function parseBoolean(rawValue, defaultValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue;
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  const value = String(rawValue).toLowerCase();
  if (value === "true" || value === "1" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "false" || value === "0" || value === "no" || value === "off") {
    return false;
  }
  return defaultValue;
}

export function parseGender(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "" || rawValue === "auto") {
    return null;
  }
  const v = String(rawValue).toUpperCase().trim();
  if (v === "M" || v === "MALE") return "M";
  if (v === "F" || v === "FEMALE") return "F";
  return null;
}

export function getErrorDetail(err) {
  const responseData = err?.response?.data;
  if (responseData?.detail) {
    return String(responseData.detail);
  }
  if (Buffer.isBuffer(responseData)) {
    const rawText = responseData.toString("utf8");
    try {
      const parsed = JSON.parse(rawText);
      return String(parsed?.detail || rawText);
    } catch {
      return String(rawText);
    }
  }
  if (typeof responseData === "string") {
    return responseData;
  }
  if (responseData) {
    return String(responseData);
  }
  return String(err?.message || err || "Unknown error");
}
