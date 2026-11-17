# Ansøgning om beskyttede kundedata (Shopify)

Gælder produktionsappen **PREAURA** (ikke PREAURA Test). Testappen kører kun
på udviklingsbutikker og skal ikke søge.

Sted: Dev Dashboard → Apps → PREAURA → Settings → Access requests →
Protected customer data → Manage.

## Hvad der søges om

| Data | Søges | Hvorfor |
| --- | --- | --- |
| Customer data (ordrer) | Ja | Tildeling af enheder til leverancer, dato på ordren, frigivelse |
| Name | Ja | Kun i hændelser til Flow, webhook og Klaviyo, når butikken slår dem til |
| Email | Ja | Samme |
| Address | Nej | Bruges ikke |
| Phone | Nej | Bruges ikke |

Appen virker også uden navn og e-mail: hændelserne sendes så uden kunde
(`app/sync/shopifyGateway.server.ts`, `readOrderDetails`).

## Begrundelser (indsættes på engelsk)

**Customer data**

> PREAURA reads orders to allocate each pre-ordered unit to an incoming delivery, write the promised ship date on the order, and release units when an order is cancelled or a payment is declined. Only the order id, order number, quantities and dates are stored.

**Name**

> Only when the merchant turns on pre-order events for Shopify Flow, their own webhook or Klaviyo: the customer's first and last name are included in status events (created, delayed, ready to ship, cancelled, payment declined) so the merchant can notify the customer. Stored encrypted and deleted after 30 days.

**Email**

> Only when the merchant turns on pre-order events for Shopify Flow, their own webhook or Klaviyo: the customer's email is included in status events so the merchant can notify the customer about their pre-order. Stored encrypted and deleted after 30 days. Never used for marketing by PREAURA.

## Data protection details

Level 1

| Krav | Svar | Bevis |
| --- | --- | --- |
| Process the minimum personal data | Yes | Kun id, nummer, antal og datoer gemmes; navn og e-mail kun ved hændelser |
| Inform merchants what data you process and why | Yes | https://preaura.onrender.com/privacy |
| Limit processing to stated purposes | Yes | Privatlivspolitik og databehandleraftale |
| Respect customer consent decisions | Yes | Ventelisten giver kun besked om varen; butikken ansvarlig for grundlag ved webhook og Klaviyo |
| Respect opt-outs of data sale or sharing | Yes | Intet sælges; deling kun på butikkens instruks |
| Respect opt-outs of automated decision-making | Yes | Ingen automatiske afgørelser med retsvirkning |
| Data protection agreement with merchants | Yes | https://preaura.onrender.com/dpa |
| Retention periods | Yes | Hændelser 30 dage, venteliste højst 180 dage, adgangslog 365 dage, alt slettes ved shop/redact |
| Encrypt data at rest and in transit | Yes | HTTPS; Render-databasen krypteret; navn, e-mail og nøgler desuden AES-256-GCM |

Level 2

| Krav | Svar | Bevis |
| --- | --- | --- |
| Encrypt backups | Yes | Renders krypterede backups |
| Separate test and production data | Yes | To apps, to servere, to databaser (`AGENTS.md`) |
| Data loss prevention strategy | Yes | `docs/security.md` |
| Limit staff access | Yes | Kun den ansvarlige har adgang |
| Strong password requirements | Yes | Adgangskodemanager og totrinsbekræftelse overalt |
| Log access to personal data | Yes | Tabellen `AccessLog` |
| Security incident response policy | Yes | `docs/security.md`, afsnit 4 |
