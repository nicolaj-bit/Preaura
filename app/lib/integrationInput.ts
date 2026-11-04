// Kontrol af det, webshopejeren indtaster under Hændelser. Ren funktion,
// så reglerne kan testes.

/**
 * Webhook-adressen skal være en offentlig https-adresse. Interne adresser
 * afvises, så appen ikke kan bruges til at kalde ind i sit eget netværk.
 */
export function validateWebhookUrl(
  input: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: "Adressen er ikke en gyldig URL." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Adressen skal starte med https://." };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      error: "Adressen må ikke indeholde brugernavn eller adgangskode.",
    };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host) ||
    // IPv6: lokal, privat (fc00::/7) og link-lokal (fe80::/10).
    (host.includes(":") &&
      (host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)));
  if (privateHost) {
    return {
      ok: false,
      error: "Adressen skal være offentlig tilgængelig på internettet.",
    };
  }
  return { ok: true, url: url.toString() };
}

/** Klaviyos private API-nøgler starter med pk_. */
export function validateKlaviyoKey(
  input: string,
): { ok: true; key: string } | { ok: false; error: string } {
  const key = input.trim();
  if (!/^pk_[A-Za-z0-9]{10,}$/.test(key)) {
    return {
      ok: false,
      error:
        "Det ligner ikke en privat Klaviyo-nøgle. Den starter med pk_ og findes under Settings → API keys i Klaviyo.",
    };
  }
  return { ok: true, key };
}
