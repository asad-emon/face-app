export function logApiError(context, err) {
  const responseData = err?.response?.data;
  let detail = err?.message || err;

  if (responseData?.detail) {
    detail = responseData.detail;
  } else if (Buffer.isBuffer(responseData)) {
    const rawText = responseData.toString("utf8");
    try {
      const parsed = JSON.parse(rawText);
      detail = parsed?.detail || rawText;
    } catch {
      detail = rawText;
    }
  } else if (typeof responseData === "string") {
    detail = responseData;
  } else if (responseData) {
    detail = responseData;
  }

  console.error(`[ERROR] ${context}:`, detail);
  if (err?.stack) {
    console.error(err.stack);
  }
}
