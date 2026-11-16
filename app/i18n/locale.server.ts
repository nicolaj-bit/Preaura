import { forShop } from "../models/preorder.server";
import { DEFAULT_LOCALE, resolveLocale, type Locale } from "./index";
import { localeFromHeaders } from "./headers";

// Hvilket sprog appen skal vises på. Shopify sætter ?locale= på adressen,
// når appen åbnes i Shopify Admin (sproget i butiksejerens Admin). Senere
// anmodninger i appen har den ikke, så sproget huskes pr. butik.
//
// Rækkefølge: adressens locale → det huskede → browserens sprog → engelsk.

export async function localeFor(
  request: Request,
  shop: string,
): Promise<Locale> {
  const settings = forShop(shop).settings;
  const fromUrl = resolveLocale(
    new URL(request.url).searchParams.get("locale"),
  );
  const saved = (await settings.get()).adminLocale;
  if (fromUrl) {
    if (saved !== fromUrl) await settings.setAdminLocale(fromUrl);
    return fromUrl;
  }
  return resolveLocale(saved) ?? localeFromHeaders(request) ?? DEFAULT_LOCALE;
}

export { localeFromHeaders };
