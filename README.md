# PREAURA

Offentlig Shopify-app (distribution gennem Shopify App Store), udviklet af
LALATOTO of Denmark ApS. Bygget på Shopifys officielle app-skabelon
(React Router — efterfølgeren til Remix-skabelonen) med Polaris og App Bridge.

Status: leverancer, selling plans og lagerstyring. Appen skriver selling
plans og lagerantal til Shopify for varianter med forudbestilling slået til.
Ordrer behandles endnu ikke (se «Før appen bruges til rigtigt salg»).

## Hvad er sat op

- **Scopes:** `read_products`, `write_products`, `read_inventory`,
  `write_inventory`, `read_orders`, `write_orders` og
  `write_purchase_options` (krævet for at oprette selling plans). Se
  `shopify.app.toml`.
- **Compliance-webhooks** (`customers/data_request`, `customers/redact`,
  `shop/redact`) → `app/routes/webhooks.compliance.tsx`.
- **Ordre-webhooks** (`orders/create`, `orders/updated`, `orders/cancelled`)
  → `app/routes/webhooks.orders.tsx`.
- **`app/uninstalled`** → `app/routes/webhooks.app.uninstalled.tsx`.
- **Admin-side** → `app/routes/app._index.tsx`. Viser butikkens navn.

Alle webhooks verificerer HMAC-signaturen (forkert signatur giver 401),
lægger hændelsen i tabellen `WebhookEvent` og svarer 200. Gentagne leveringer
genkendes på `X-Shopify-Webhook-Id` og lægges ikke i køen to gange. Køen
behandles ikke endnu — det kommer senere.

## Datamodel

Fire tabeller i `prisma/schema.prisma`, alle med en `shop`-kolonne:

| Tabel | Hvad |
| --- | --- |
| `ShopSetting` | Én række pr. butik: dato som afsendelse eller levering, og tekster. |
| `VariantPlan` | Én række pr. variant: produkt, lager-id'er, og om forudbestilling er slået til. Et produkt er slået til, hvis mindst én variant er. |
| `Delivery` | Leverancer pr. variant: rækkefølgenummer, dato, antal, status (`OPEN`/`CANCELLED`) og et tomt `sellingPlanId`. |
| `Allocation` | Hvilken ordrelinje har fået plads i hvilken leverance. Slettes aldrig — annullering sætter status. Unik pr. ordrelinje. |

Regler, alt andet hviler på (`app/lib/deliveries.ts`):

- **Resterende antal gemmes ikke.** Det er altid leverancens antal minus
  summen af aktive tildelinger.
- **Aktiv leverance** er den første efter rækkefølgenummer, der hverken er
  annulleret eller udsolgt.
- **Validering:** datoen skal ligge efter i dag (i butikkens tidszone),
  antal skal være større end nul, og antal må ikke sættes under det tildelte.
- En leverance med tildelinger kan ikke slettes, kun annulleres.

**Adskillelse mellem butikker:** al adgang til de fire tabeller går gennem
`forShop(shop)` i `app/models/preorder.server.ts`, og `shop` kommer altid fra
den godkendte Shopify-session. En lint-regel afviser direkte brug af
tabellerne andre steder.

## Synkronisering med Shopify

Al skrivning til Shopify sker i `syncVariant()` i
`app/sync/syncVariant.server.ts`. Den tager én variant og bringer Shopify i
overensstemmelse med appens data:

- **Én selling plan group pr. variant**, knyttet til varianten.
- **Én selling plan pr. åben leverance**: kategori `PRE_ORDER`, fuld betaling
  ved bestilling (100 %, ingen restbetaling), afsendelse på leverancens dato
  (`EXACT_TIME`, kl. 12:00 UTC), og lageret bindes ved salg (`ON_SALE`).
  Planens id gemmes på leverancen.
- **Lager:** lagersporing slået til, inventory policy `DENY`, og tilgængeligt
  antal = det resterende i den aktive leverance. Shopify stopper selv salget
  ved 0.

Regler:

- **En selling plan ændres aldrig.** Afviger den fra sin leverance (fx ny
  dato), oprettes en ny, og den gamle tages ud af brug. Shopify-laget
  (`app/sync/gateway.ts`) har slet ingen metode til at ændre en plan.
  Eksisterende ordrer beholder deres løfte: ordren gemmer selv sin plan og
  sin afsendelsesdato.
- **Idempotent:** den læser Shopify først og skriver kun det, der afviger.
  Den køres efter hver ændring i admin og kan køres igen («Synkronisér») for
  at reparere.
- **Ingen stille fejl:** userErrors fra Shopify stopper synkroniseringen, og
  fejlen vises på varianten i admin, indtil en synkronisering lykkes.
- Slås forudbestilling fra, tages varianten ud af sin gruppe. Lageret røres
  ikke.

To lint-regler håndhæver arkitekturen: GraphQL-mutationer må kun stå i
`app/sync/shopifyGateway.server.ts`, og resten af appen må kun bruge
synkroniseringen gennem `app/sync/index.server.ts`.

## Krav

- Node.js 22.12 eller nyere
- Shopify CLI: `npm install -g @shopify/cli@latest`
- En Shopify Partner-konto i organisationen «LALATOTO of Denmark ApS»
- En udviklingsbutik (oprettes i Dev Dashboard → Stores)

## Første gang: forbind projektet til appen i Shopify

```bash
npm install
npm run config:link
```

Appen er allerede oprettet (PREAURA under LALATOTO of Denmark ApS), og
`client_id` står i `shopify.app.toml`. Vælg den eksisterende app, når
`config:link` spørger.

**Pas på:** `config:link` overskriver `shopify.app.toml` med Shopifys
standardkonfiguration og tømmer bl.a. listen over scopes. Kør `git diff`
bagefter, og fortryd med `git checkout -- shopify.app.toml`, hvis noget
er forsvundet.

Bagefter, i Shopify Dev Dashboard under appen:

1. **Distribution → Public distribution (Shopify App Store).** Vælg *ikke*
   custom distribution. Valget kan ikke ændres bagefter.
2. **API access → Protected customer data access:** anmod om adgang til
   ordredata (niveau 1). Uden den kan appen ikke abonnere på ordre-webhooks.
   På udviklingsbutikker virker det med det samme; til App Store-godkendelsen
   skal begrundelsen udfyldes.

## Kør lokalt og installer på en udviklingsbutik

```bash
npm run dev
```

Shopify CLI starter appen, laver en offentlig tunnel, opretter den lokale
database og sender konfigurationen (scopes og webhooks) til
udviklingsbutikken. Første gang spørger den, hvilken butik der skal bruges.

Tryk **P** i terminalen for at åbne appen. Shopify viser
installationsdialogen med de seks scopes; godkend, og appen åbner inde i
Shopify Admin med butikkens navn. Så virker installation, OAuth og
indlejring.

Prøv en webhook af uden at lave en rigtig ordre med
`shopify app webhook trigger`, som spørger efter emne og adresse
(fx `orders/create` og `/webhooks/orders`).

## Miljøvariabler

Under `npm run dev` sætter Shopify CLI dem selv. I produktion skal de sættes
på serveren:

| Variabel | Hvad |
| --- | --- |
| `SHOPIFY_API_KEY` | Appens client ID fra Dev Dashboard |
| `SHOPIFY_API_SECRET` | Appens client secret. Bruges også til at verificere webhooks |
| `SHOPIFY_APP_URL` | Den offentlige adresse, appen kører på, fx `https://preaura.example.com` |
| `SCOPES` | `read_products,write_products,read_inventory,write_inventory,read_orders,write_orders` |
| `PORT` | Port, serveren lytter på (valgfri, standard 3000) |
| `SHOP_CUSTOM_DOMAIN` | Kun hvis butikker bruger et eget admin-domæne (valgfri) |

Databasen er SQLite (`prisma/dev.sqlite`) til lokal udvikling. I produktion
skal den skiftes til en rigtig database (fx PostgreSQL) i
`prisma/schema.prisma`, fordi SQLite-filen forsvinder ved hver udrulning på
de fleste hosting-platforme.

## Udrulning

```bash
npm run build
npm run setup   # prisma generate + migrate deploy
npm run start
```

Konfigurationen i `shopify.app.toml` (scopes, webhooks, URL'er) sendes til
Shopify med `npm run deploy`.

## Tjek før push

```bash
npm run graphql-codegen   # første gang: henter Shopifys skema til testene
npm test
npm run typecheck
npm run lint
```

De samme tjek kører automatisk på GitHub ved hvert push
(`.github/workflows/checks.yml`).

## Før appen bruges til rigtigt salg

**Ordrer bliver endnu ikke til tildelinger.** Ordre-webhooks lægges i kø, men
behandles ikke. Shopify trækker selv fra lageret ved hvert salg, men appens
«resterende» tæller ikke salget med. Kører en synkronisering efter et salg
(fx fordi en leverance rettes), sætter den lageret tilbage til appens tal —
og så kan varen sælges igen. Køen skal behandles til tildelinger, før appen
bruges i en rigtig butik.

## Før indsendelse til App Store

Shopifys spørgsmål om databeskyttelse (Partner Dashboard → API access →
Protected customer data access) er besvaret ærligt for udviklingsfasen.
Disse svar står til «Nej» og skal være «Ja», før appen sendes til
godkendelse:

- **Fortæller shopejere, hvilke persondata vi behandler:** kræver en
  privatlivspolitik for PREAURA, som der linkes til fra App Store-siden.
- **Aftaler om databeskyttelse med shopejere:** kræver en
  databehandleraftale (DPA) som del af appens vilkår.
- **Opbevaringsperioder:** køtabellen `WebhookEvent` gemmer ordredata uden
  udløb. Der skal laves sletning af behandlede hændelser efter en fast
  periode, og `customers/redact` og `shop/redact` skal faktisk slette data.
- **Kryptering ved lagring og overførsel:** overførsel er HTTPS. Lagring
  kræver en database, der krypterer data (fx en administreret PostgreSQL),
  i stedet for SQLite.
