import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { forShop } from "../models/preorder.server";
import { resolveLocale } from "../i18n";

// Sprogvælgeren. Gemmer butiksejerens eget valg af sprog i appen; «auto»
// sletter valget, så appen igen følger sproget i Shopify Admin. Efter
// handlingen henter React Router alle sider igen, så teksterne skifter.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const value = String(form.get("locale") ?? "");
  const locale = value === "auto" ? null : resolveLocale(value);
  if (value !== "auto" && !locale) return { ok: false as const };
  await forShop(session.shop).settings.setChosenLocale(locale);
  return { ok: true as const };
};
