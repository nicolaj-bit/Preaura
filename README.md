# PREAURA

Offentlig Shopify-app (distribution gennem Shopify App Store), udviklet af
LALATOTO of Denmark ApS. Bygget på Shopifys officielle app-skabelon
(React Router — efterfølgeren til Remix-skabelonen) med Polaris og App Bridge.

Status: leverancer, selling plans, lagerstyring og behandling af ordrer.
Appen skriver selling plans og lagerantal til Shopify for varianter med
forudbestilling slået til, og leveringsdato og tag på forudbestilte ordrer.

## Hvad er sat op

- **Scopes:** `read_products`, `write_products`, `read_inventory`,
  `write_inventory`, `read_orders`, `write_orders` og
  `write_purchase_options` (krævet for at oprette selling plans). Se
  `shopify.app.toml`.
- **Compliance-webhooks** (`customers/data_request`, `customers/redact`,
  `shop/redact`) → `app/routes/webhooks.compliance.tsx`.
- **Ordre-webhooks** (`orders/create`, `orders/updated`, `orders/cancelled`,
  `refunds/create`) → `app/routes/webhooks.orders.tsx`.
- **`app/uninstalled`** → `app/routes/webhooks.app.uninstalled.tsx`.
- **Admin-sider** (Polaris):
  - `app/routes/app._index.tsx` — produkter i appen; nye vælges med
    Shopifys produktvælger.
  - `app/routes/app.products.$productId.tsx` — forudbestilling og
    leverancer pr. variant, samt synkroniseringsstatus mod Shopify.
  - `app/routes/app.settings.tsx` — butiksindstillinger.

Alle webhooks verificerer HMAC-signaturen (forkert signatur giver 401),
lægger hændelsen i tabellen `WebhookEvent` og svarer 200. Gentagne leveringer
genkendes på `X-Shopify-Webhook-Id` og lægges ikke i køen to gange.
Ordre-hændelser behandles bagefter af køen (se «Behandling af ordrer»);
compliance-hændelser markeres endnu som «ikke behandlet».

## Datamodel

Fire tabeller i `prisma/schema.prisma`, alle med en `shop`-kolonne:

| Tabel | Hvad |
| --- | --- |
| `ShopSetting` | Én række pr. butik: dato som afsendelse eller levering, og tekster. |
| `VariantPlan` | Én række pr. variant: produkt, lager-id'er, og om forudbestilling er slået til. Et produkt er slået til, hvis mindst én variant er. |
| `Delivery` | Leverancer pr. variant: rækkefølgenummer, dato, antal, status (`OPEN`/`CANCELLED`) og et tomt `sellingPlanId`. |
| `Allocation` | Hvilken ordrelinje har fået plads i hvilken leverance, med den dato kunden blev lovet. Status `ACTIVE`, `UNRESOLVED` (ingen plads) eller `CANCELLED`. Slettes aldrig, og antal ændres aldrig — en ændring annullerer rækken og opretter en ny. En linje kan fordeles over flere leverancer; den unikke nøgle er derfor *én aktiv række pr. linje og leverance* (partielt indeks i migrationen). |
| `SellingPlanRef` | Hvilken leverance hver selling plan hører til — også planer, der er taget ud af brug. |

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

Al skrivning til Shopify sker i synkroniseringen i `app/sync/`:
`syncVariant()` for en variants selling plans og lager, og `syncOrder()` for
en ordres leveringsdato og tags. Begge læser Shopify først og skriver kun det,
der afviger. `syncVariant()` tager én variant og bringer Shopify i
overensstemmelse med appens data:

- **Én selling plan group pr. variant**, knyttet til varianten.
- **Én selling plan pr. åben leverance**: kategori `PRE_ORDER`, betaling
  ved afsendelse (0 % ved bestilling, resten `ON_FULFILLMENT`), afsendelse på leverancens dato
  (`EXACT_TIME`, kl. 12:00 UTC), og lageret bindes ved salg (`ON_SALE`).
  Planens id gemmes på leverancen.
- **Lager:** lagersporing slået til, inventory policy `DENY`, og tilgængeligt
  antal = det resterende i den aktive leverance. Shopify stopper selv salget
  ved 0.

- **Kun forudbestilling eller blandet:** er alle produktets varianter på
  forudbestilling, sætter appen produktets `requiresSellingPlan`, så
  «Engangskøb» forsvinder. Er kun nogle, sættes den ikke (den gælder hele
  produktet) — så beskytter app-blokken og sikkerhedsnettet. Appen slår den
  kun fra igen, hvis det var appen, der satte den.

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

## Behandling af ordrer

`app/orders/processQueue.server.ts` omsætter ordre-hændelser i køen til
tildelinger:

- **Ordren læses frisk fra Shopify** ved hver behandling, og tildelingerne
  bringes i overensstemmelse med den (`currentQuantity` efter rettelser og
  refunderinger). Derfor tæller en gensendt webhook aldrig to gange, og
  rækkefølgen af `create`/`updated`/`cancelled` er ligegyldig.
- **Selling plan-id'et afgør leverancen.** Er der ikke plads, fyldes resten
  i de følgende leverancer. Er der ingen plads nogen steder, bliver resten
  *uafklaret*: ordren tagges «Forudbestilling uafklaret» og vises under
  Ordrebehandling i admin. Behandles ordren igen, når der er plads, afklares
  den.
- **Sikkerhedsnettet: hver solgt enhed tælles.** Har en ordrelinje ingen af
  appens selling plans (almindeligt køb, kladdeordre, POS, API eller en anden
  apps plan), men er varianten på forudbestilling, lægges linjen alligevel i
  den aktive leverance og mærkes «købt uden plan». Ellers ville Shopify have
  trukket lageret ned, og næste synkronisering skrive det op igen. Kun ordrer
  oprettet efter, at forudbestilling blev slået til, tælles. Salg uden plan
  vises samlet under Ordrebehandling.
- **Først til mølle efter bestillingstidspunkt**: hændelser behandles i
  ordrens oprettelsesrækkefølge. Behandlingen venter 5 sekunder efter en
  webhook, så ordrer, der kommer næsten samtidig, sorteres korrekt.
- **Én behandler ad gangen pr. butik** (lås i databasen, `QueueLock`), så
  to ordrer aldrig læser det samme resterende antal.
- **Ordren får sit løfte frosset:** metafeltet `preaura.promised_date` (dato)
  og `preaura.allocations` (json), plus tagget «Forudbestilling». Datoen
  kommer fra tildelingen, så en senere ændret leverance ikke ændrer den.
- Bagefter synkroniseres variantens lager, så Shopify igen står på det
  resterende antal.
- **Fejl** lander på listen under Ordrebehandling med «Prøv igen». En
  periodisk fejning (hvert minut) samler ventende hændelser op efter en
  genstart.

## Produktsiden (Theme App Extension)

`extensions/preaura-preorder/` er en app block, som webshopejeren selv
placerer i produktsektionen i temaeditoren (Tilpas → Produktside → Tilføj
blok → Apps → Forudbestilling). Ingen app embed og ingen kode i temaet.

- **Data uden netværkskald:** synkroniseringen skriver metafeltet
  `preaura.preorder` (json) på hver variant — om forudbestilling er aktiv,
  visning (afsendelse/levering), den aktive leverances dato og selling
  plan-id, resterende antal, og om alt er udsolgt. Blokken læser det i Liquid
  for alle varianter ved sideindlæsning.
- **To skjulte felter i produktformularen**, holdt opdateret ved
  variantskifte: `selling_plan` og en synlig linjeegenskab, fx
  `properties[Forventet afsendelse]`. Linjeegenskaben vises af Shopify i
  kurv, checkout, ordrebekræftelse og på ordren — uden at tema eller
  mailskabelon skal rettes — og fryser datoen fast i købsøjeblikket.
- **Variantskifte** opdages via temaernes hændelser og en reserve, der hvert
  250 ms læser formularens skjulte felt `id` (gamle temaer).
- **Rører ikke temaet:** ingen skrifttyper, størrelser eller farver;
  variantvælger og købsknap røres ikke. Knappens tekst ændres kun, hvis
  indstillingen er slået til (standard: fra).
- **Udsolgt:** tydelig besked, og hverken plan eller linjeegenskab.
- Alle kundevendte tekster er indstillinger på blokken. Datoen formateres
  på butikkens sprog.

- **Temaets egne anmodninger:** mange temaer sender ikke formularen, som den
  står, men bygger deres egen anmodning til `/cart/add`. Blokken lægger plan
  og dato på temaets anmodning (fetch og XMLHttpRequest), hvis varen er en
  variant på forudbestilling, og de mangler. Andre varianter og andre
  anmodninger røres ikke.

**Ret i `theme-extension-src/preaura-preorder.js`**, ikke i `assets/`. Filen i `assets/` er en
komprimeret udgave (Shopify tillader højst 10 KB JavaScript pr. app block) og
bygges med `npm run build:block` (sker også automatisk før `npm test`).
Kilde og tests ligger uden for extensionen, fordi Shopify kun tillader
mapperne `assets`, `blocks`, `snippets` og `locales` i en theme app extension.

Tjek blokken med `shopify theme check --path extensions/preaura-preorder`.

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
installationsdialogen med appens scopes; godkend, og appen åbner inde i
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

## Kendte begrænsninger

- **Betaling ved afsendelse:** kunden betaler intet ved bestilling. Shopify
  gemmer betalingsmidlet og trækker beløbet, når ordren sendes. Er kortet
  udløbet eller uden dækning, står ordren som ikke betalt — tjek
  betalingsstatus, før en forudbestilling sendes. Kræver Shopify Payments
  eller en betalingsudbyder, der understøtter udskudt betaling.

- **Rækkefølgen er kun sikret inden for samme behandlingsrunde.** Kommer en
  ordre frem mere end nogle sekunder efter en senere ordre, og er der netop
  ikke plads til begge i leverancen, beholder den senere ordre sin plads —
  et lovet leveringsløfte flyttes ikke. Shopifys lager (DENY) forhindrer
  normalt situationen helt.
- **Besked til webshopejeren** sker i admin (banner og Ordrebehandling) og
  med et tag på ordren i Shopify — ikke på mail.
- **Køen kører i appens egen proces.** Kører appen på flere servere, sikrer
  låsen i databasen stadig, at kun én behandler arbejder ad gangen.

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
  De lægges i kø i dag, men markeres som «ikke behandlet». Bemærk, at
  tildelinger ellers aldrig slettes — `shop/redact` er den eneste bevidste
  undtagelse.
- **Kryptering ved lagring og overførsel:** overførsel er HTTPS. Lagring
  kræver en database, der krypterer data (fx en administreret PostgreSQL),
  i stedet for SQLite.
