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
- **Lager-webhook** (`inventory_levels/update`) →
  `app/routes/webhooks.inventory.tsx`.
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
Ordre-hændelser behandles bagefter af køen (se «Behandling af ordrer»),
compliance-hændelser også (se «Databeskyttelse (GDPR)»).

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

## Lagermode og forudbestillingsmode

Hver variant med forudbestilling slået til er i én af to tilstande, og appen
skifter selv (`app/lib/variantMode.ts`, afgjort i `syncVariant()`):

- **Lagermode:** der er rigtige varer. Appen rører hverken lagertal eller
  selling plans, og produktsiden ser ud som enhver anden vare.
- **Forudbestillingsmode:** appen ejer lagertallet (= resterende i den aktive
  leverance) og tilbyder selling plan.

Skift:

- **Lager → forudbestilling:** når Shopifys tilgængelige antal rammer 0, og
  der er plads i en leverance.
- **Forudbestilling → lager:** når der kommer rigtige varer ind, dvs. Shopify
  står højere, end appen selv satte det. Varerne går først til de
  forudbestillinger, der allerede er solgt; kun resten bliver almindeligt
  lager. **Registrér varemodtagelsen som en tilføjelse** (fx +150), ikke ved
  at skrive et nyt optalt tal.
- **Tvunget forudbestilling:** webshopejeren kan tvinge en variant i
  forudbestilling, selvom der er lager. Lageret fra før og varer, der kommer
  ind imens, gives tilbage, når tvangen slås fra.
- Et skift rører aldrig eksisterende tildelinger eller ordrer. Går en
  variant i lagermode, tages gruppen af varianten, men gruppen og planerne
  slettes ikke.
- `inventory_levels/update` opdager lagerændringer uden for appen og går
  gennem samme kø som ordrerne — efter ordrerne i samme omgang. Sikkerheds-
  nettet tæller kun salg uden plan, hvis varianten var i forudbestilling, da
  ordren blev lagt (`ModeChange`-historikken).

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

## Drift på Render

Appen kører på [Render](https://render.com) i Frankfurt (EU). Opsætningen står
i `render.yaml`: en webserver (`preaura`) og en PostgreSQL-database
(`preaura-db`), som kun appen kan nå. Render krypterer databasen og tager
selv backup.

- **Udrulning:** hver merge til `main` udrulles automatisk. Render bygger
  appen, kører databasens migrationer og skifter først til den nye version,
  når `/healthz` svarer.
- **Konfigurationen i Shopify** (URL'er, scopes, webhooks) og app-blokken
  til temaet sendes med `npm run deploy` fra en computer. Det skal kun gøres,
  når `shopify.app.toml` eller `extensions/` er ændret.
- **Logs:** Render → preaura → Logs.

### Første opsætning

1. Render → **New → Blueprint** → vælg repoet `nicolaj-bit/preaura`.
2. Indsæt `SHOPIFY_API_SECRET` (Dev Dashboard → PREAURA → Settings →
   Client secret), når Render spørger. Godkend.
3. Tjek, at adressen er `https://preaura.onrender.com`. Er den en anden,
   skal `application_url` og `redirect_urls` i `shopify.app.toml` rettes.
4. Kør `npm run deploy` fra en computer, så Shopify sender butikkerne og
   webhooks til Render.

### Miljøvariabler

Sættes af `render.yaml`. Kun `SHOPIFY_API_SECRET` skal indtastes.

| Variabel | Hvad |
| --- | --- |
| `DATABASE_URL` | Adressen på databasen. Sættes af Render |
| `SHOPIFY_API_KEY` | Appens client ID |
| `SHOPIFY_API_SECRET` | Appens client secret. Bruges også til at verificere webhooks |
| `SHOPIFY_APP_URL` | Appens adresse. Udelades på Render, der selv sætter `RENDER_EXTERNAL_URL` |
| `SCOPES` | Samme liste som i `shopify.app.toml` |
| `SHOP_CUSTOM_DOMAIN` | Kun hvis butikker bruger et eget admin-domæne (valgfri) |

## Testmiljø

Produktion og test er to helt adskilte miljøer — se reglerne i `AGENTS.md`.
Kort: hver sin app i Shopify, hver sin server og database på Render, egne
hemmeligheder, og data kopieres aldrig mellem dem.

```bash
npm run config:test     # arbejd mod testappen
npm run deploy:test     # udrul konfiguration og extensions til testappen
npm run config:prod     # tilbage til produktionsappen
npm run deploy:prod     # udrul til produktionsappen
```

`npm run deploy` alene nægter at køre, så man ikke kommer til at udrulle til
det forkerte miljø.

## Abonnement og rettigheder

Shopify App Pricing: planerne oprettes i Partner Dashboard, Shopify er vært
for prisvalgssiden og opretter abonnementet. Appen bygger ingen prisside og
kalder ikke `appSubscriptionCreate`.

- **Planerne** står i `config/plans.json` som plannøgler (`gratis`, `basis`,
  `pro`) med funktioner og grænser. `shopifyHandles` oversætter fra
  plan-handle i Shopify. Kan overstyres uden kodeændring med miljøvariablen
  `PREAURA_PLANS_JSON`.
- **Adgangen** læses fra butikkens aktive abonnement i Shopify (Partner API,
  `activeSubscription`) — ikke fra vores database. Svaret caches i 5 minutter
  (`PREAURA_ENTITLEMENT_TTL_SECONDS`) og tømmes, når butikken kommer tilbage
  fra prisvalgssiden.
- **Intet aktivt abonnement:** appens rod omdirigerer til Shopifys
  prisvalgsside med `target: "_top"`, så siden forlader app-rammen.
- **Fejler Shopify,** beholder en butik med kendt abonnement sin adgang;
  ingen sendes til prisvalg på grund af en fejl.
- **Slås til** med `PREAURA_BILLING=shopify` og miljøvariablerne
  `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN`,
  `SHOPIFY_APP_GID` og `PREAURA_APP_HANDLE` (pr. miljø, sat i Render).
- **Test af planer:** en udviklingsbutik i samme Partner-organisation kan
  vælge enhver plan til 0 kr. Billing API'ens `test`-felt bruges ikke.

### Sådan gøres en funktion planafhængig

1. Tilføj funktionens nøgle til `FEATURES` i `app/billing/plans.ts`, fx
   `"rapporter"`.
2. Skriv den på de planer, der skal have den, i `config/plans.json`.
3. Én kontrol i funktionens loader og action:

   ```ts
   const access = await accessFor(admin, session.shop);
   requireFeature(access, "rapporter"); // 403, hvis planen ikke giver adgang
   ```

   Til at skjule en knap: `can(access.entitlement, "rapporter")`. Til en
   talgrænse: tilføj den til `LIMITS` og læs den med `limitOf(...)`.

### Nedgradering og opsigelse

- **Nedgradering:** funktioner, den nye plan ikke har, lukkes. Leverancer,
  tildelinger, ordrer, hændelser og indstillinger bliver stående uændret.
  Opgraderer butikken igen, er alt der.
- **Opsigelse (appen stadig installeret):** appen sender til prisvalgssiden.
  Intet slettes eller nulstilles.
- **Afinstallation** er noget andet: Shopify sender `shop/redact` 48 timer
  efter, og så sletter appen butikkens data, som GDPR kræver (se
  «Databeskyttelse»).
- Ordrebehandlingen (kø, tildelinger, lager, hændelser) kører uafhængigt af
  planen, så løfter, der allerede er givet, stadig holdes.

## Lokal udvikling

`automatically_update_urls_on_dev` står til `false`, så `npm run dev` aldrig
skriver en midlertidig tunnel-adresse ind i den rigtige app. Lokal
udvikling kræver derfor:

- **En egen udviklings-app:** `npm run config:link` → opret en ny app
  (fx «PREAURA Dev»), så der laves en `shopify.app.<navn>.toml`. Slå
  `automatically_update_urls_on_dev` til i den fil.
- **En PostgreSQL-database:** sæt `DATABASE_URL` i `.env`.

Testene bruger `TEST_DATABASE_URL` (standard
`postgresql://postgres:postgres@localhost:5432/preaura_test`). Hver testfil
får sit eget skema og rydder op efter sig.

## Tjek før push

```bash
npm run graphql-codegen   # første gang: henter Shopifys skema til testene
npm test
npm run typecheck
npm run lint
```

De samme tjek kører automatisk på GitHub ved hvert push
(`.github/workflows/checks.yml`).

## Udgående hændelser (Flow, webhook, Klaviyo)

Fire hændelser: `preorder.created`, `preorder.delayed`, `preorder.ready` og
`preorder.cancelled`. Indholdet bestemmes ét sted, `app/events/build.ts`;
modtagerne i `app/events/channels.ts` omformaterer kun.

- **Hvor de opstår** (`app/models/preorder.server.ts`), i samme
  transaktion som ændringen og med en `dedupeKey`, så samme ændring kun
  giver én hændelse:
  - *oprettet*: en ordrelinje får for første gang plads i en leverance.
  - *annulleret*: linjen annulleres, refunderes helt eller fjernes.
  - *forsinket*: en leverances dato rykkes senere (linjer, der ikke er klar).
  - *klar til afsendelse*: varerne er kommet. Sker af sig selv kun, når de
    modtagne varer dækker alle ventende forudbestillinger (og varianten
    skifter til lagermode). Ellers med knappen «Varerne er kommet» på
    leverancens side. En mindre stigning i lageret giver aldrig hændelsen —
    den kan skyldes en annullering, en refundering eller Shopify selv.
- **Afsenderen** (`app/events/outbox.server.ts`) kører efter køen og hvert
  minut. Den bygger hver hændelse én gang med kundens navn og e-mail fra
  Shopify, gemmer den krypteret og sender til hver modtager for sig. Fejl
  prøves igen 10 gange med voksende ventetid (1, 2, 4 … minutter, omkring 8
  timer i alt) og står derefter under **Hændelser → Fejlede leveringer**.
- **Shopify Flow:** fire triggere i `extensions/preaura-flow-*`. Felterne
  skal svare til `toFlowPayload()`.
- **Webhook:** JSON med POST, signeret med HMAC-SHA256 (base64) i
  `X-Preaura-Hmac-Sha256`. Vejledning til Zapier og Make: `docs/webhook.md`.
- **Klaviyo:** Create Event med `unique_id` = hændelsens id, så et genforsøg
  ikke giver en dublet. API-versionen står i `KLAVIYO_REVISION`.
- **Hemmeligheder:** API-nøgle, webhook-adresse og signaturnøgle krypteres
  med `PREAURA_ENCRYPTION_KEY` (AES-256-GCM). Admin viser kun de sidste fire
  tegn (signaturnøglen vises, så modtageren kan verificere).
- **Ansvar:** webhook og Klaviyo kan først slås til, når butikken har
  bekræftet at have grundlag for at sende kundeoplysninger videre.
- **Kundens navn og e-mail** er beskyttede kundedata (niveau 2). Uden
  Shopifys godkendelse sendes hændelserne uden kunde, og Klaviyo fejler med
  en forklaring.

## Databeskyttelse (GDPR)

`app/models/compliance.server.ts`, `app/lib/webhookPayload.ts`.

- **Kun det nødvendige gemmes.** Shopify sender hele ordren med kundens
  navn, mail og adresse. Køen gemmer kun ordrens id og
  bestillingstidspunkt; resten læses frisk fra Shopify ved behandlingen.
  Migrationen `compliance` skar de allerede gemte hændelser ned på samme
  måde.
- **Hvad PREAURA gemmer om en kunde:** tildelingerne har ordrens id og
  nummer, antal og den lovede dato. Kun udgående hændelser indeholder
  kundens navn og e-mail — krypteret og slettet efter 30 dage.
- **`customers/data_request`:** anmodningen vises under Ordrebehandling med
  alt, hvad appen har om kundens ordrer, og et banner på forsiden.
  Webshopejeren sender det til kunden og markerer anmodningen som besvaret.
- **`customers/redact`:** kundens dataanmodninger, de behandlede
  kø-hændelser for kundens ordrer og navn og e-mail i udgående hændelser
  slettes. Tildelingerne bliver stående: de
  indeholder ingen persondata og er butikkens regnskab over pladserne —
  uden dem ville pladserne blive solgt igen.
- **`shop/redact`** (48 timer efter afinstallation): alt om butikken slettes,
  også tildelinger, sessioner og køen. Den eneste gang, tildelinger slettes.
- **Opbevaringsperiode:** behandlede kø-hændelser og besvarede
  dataanmodninger slettes efter 30 dage (en gang i timen). Fejlede
  hændelser bliver stående, til de er behandlet.
- Compliance-hændelser kræver ikke adgang til Shopify og behandles derfor
  også, efter appen er afinstalleret.

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
- **Opbevaringsperioder:** på plads (se «Databeskyttelse (GDPR)»). Svaret
  kan sættes til «Ja».
- **Kryptering ved lagring og overførsel:** overførsel er HTTPS, og
  databasen på Render er krypteret (se «Drift på Render»). Svaret kan sættes
  til «Ja».
