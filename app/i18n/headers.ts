import { resolveLocale, type Locale } from "./index";

/**
 * Sproget ud fra selve anmodningen, uden database: adressens ?locale=
 * (Shopify sætter den, når appen åbnes) eller browserens sprog.
 */
export function localeFromHeaders(request: Request): Locale | null {
  const fromUrl = resolveLocale(
    new URL(request.url).searchParams.get("locale"),
  );
  if (fromUrl) return fromUrl;
  const header = request.headers.get("accept-language") ?? "";
  for (const part of header.split(",")) {
    const locale = resolveLocale(part.split(";")[0]);
    if (locale) return locale;
  }
  return null;
}
