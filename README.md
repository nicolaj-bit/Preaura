# PREAURA

Offentlig Shopify-app (distribution gennem Shopify App Store), udviklet af
LALATOTO of Denmark ApS. Bygget på Shopifys officielle app-skabelon
(React Router — efterfølgeren til Remix-skabelonen) med Polaris og App Bridge.

Status: skelet. Installation, OAuth, indlejring i Shopify Admin og webhooks
virker. Ingen forretningslogik endnu.

## Hvad er sat op

- **Scopes:** `read_products`, `write_products`, `read_inventory`,
  `write_inventory`, `read_orders`, `write_orders` — ikke andre. Se
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
npm run typecheck
npm run lint
```

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
