import { forShop } from "../models/preorder.server";
import { DEFAULT_LOCALE, resolveLocale, type Locale } from "./index";
import { localeFromHeaders } from "./headers";

// Hvilket sprog appen skal vises på. Shopify sætter ?locale= på adressen,
// når appen åbnes i Shopify Admin (sproget i butiksejerens Admin). Senere
// anmodninger i appen har den ikke, så sproget huskes pr. butik.
//
// Rækkefølge: sproget, butiksejeren selv har valgt i appen → adressens
// locale → det huskede → browserens sprog → engelsk.

export async function localeFor(
  request: Request,
  shop: string,
): Promise<Locale> {
  const settings = forShop(shop).settings;
  const fromUrl = resolveLocale(
    new URL(request.url).searchParams.get("locale"),
  );
  const stored = await settings.get();
  const saved = stored.adminLocale;
  const chosen = resolveLocale(stored.adminLocaleChosen);
  if (fromUrl && saved !== fromUrl) await settings.setAdminLocale(fromUrl);
  if (chosen) return chosen;
  if (fromUrl) {
    return fromUrl;
  }
  return resolveLocale(saved) ?? localeFromHeaders(request) ?? DEFAULT_LOCALE;
}

export { localeFromHeaders };
