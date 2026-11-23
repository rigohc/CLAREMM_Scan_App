/**
 * Safe fetch wrapper that guarantees valid JSON parsing,
 * preventing Safari / WebKit DOMException "The string did not match the expected pattern".
 */
export async function safeFetchJson(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.warn(`[safeFetchJson] Server did not return JSON for ${url}:`, text.substring(0, 120));
      return {
        success: false,
        error: 'INVALID_JSON',
        message: res.ok 
          ? 'El servidor respondió con un formato no reconocido.' 
          : `Error en servidor (${res.status}): ${text.substring(0, 100) || res.statusText}`,
        status: res.status
      };
    }
    return data;
  } catch (netErr) {
    console.error(`[safeFetchJson] Network error for ${url}:`, netErr);
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: `Error de conexión: ${netErr.message}`
    };
  }
}
