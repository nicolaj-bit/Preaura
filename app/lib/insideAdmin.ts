/**
 * Kommer anmodningen fra appen inde i Shopify Admin? App Bridge sender et
 * sessionstoken med, og Shopify sætter embedded/host i adressen, når appen
 * åbnes. Bruges af appens rod (app/routes/_index), så et klik på appens navn
 * fører til appen og ikke til startsiden for besøgende udefra.
 */
export function insideAdmin(request: Request) {
  const url = new URL(request.url);
  return (
    /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "") ||
    url.searchParams.get("embedded") === "1" ||
    url.searchParams.has("host")
  );
}
