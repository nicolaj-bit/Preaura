# PREAURA-webhooken: Zapier, Make og jeres eget system

PREAURA sender fire hændelser, når der sker noget med en forudbestilling.
Har I et mailsystem, appen ikke har en indbygget forbindelse til (fx Drip,
Omnisend, Mailchimp eller Brevo), så brug webhooken. Kobl den til Zapier
eller Make, og send videre derfra.

| `type`               | Hvornår                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `preorder.created`   | En kunde har forudbestilt, og ordren har fået plads i en leverance           |
| `preorder.delayed`   | Leverancens dato er rykket senere (`previousDeliveryDate` er den gamle dato) |
| `preorder.ready`     | Varerne er kommet hjem, og ordren kan sendes                                 |
| `preorder.cancelled` | Forudbestillingen er annulleret, refunderet eller fjernet fra ordren         |

## Sådan ser et kald ud

`POST` til jeres adresse med `Content-Type: application/json`:

```json
{
  "id": "6f1c2a4e-0b2d-4a8e-9c1f-3d5e7a9b1c2d",
  "type": "preorder.ready",
  "occurredAt": "2026-12-01T09:14:03.000Z",
  "shop": "jeres-butik.myshopify.com",
  "customer": {
    "email": "anna@example.com",
    "firstName": "Anna",
    "lastName": "Jensen",
    "name": "Anna Jensen"
  },
  "order": { "id": "gid://shopify/Order/5550123", "name": "#1042" },
  "product": { "id": "gid://shopify/Product/8120", "title": "Oxygen" },
  "variant": {
    "id": "gid://shopify/ProductVariant/4471",
    "title": "158 cm",
    "sku": "OXY-158"
  },
  "quantity": 1,
  "deliveryDate": "2026-12-01",
  "previousDeliveryDate": null
}
```

Headere:

| Header                  | Indhold                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `X-Preaura-Event`       | Hændelsens type, fx `preorder.ready`                                             |
| `X-Preaura-Event-Id`    | Hændelsens id — det samme ved genforsøg. Brug det til at se bort fra gentagelser |
| `X-Preaura-Shop`        | Butikkens myshopify-domæne                                                       |
| `X-Preaura-Hmac-Sha256` | Signaturen (se nedenfor)                                                         |

Svar med en 2xx-statuskode inden for 10 sekunder. Ellers prøver PREAURA
igen op til 10 gange med voksende ventetid (1, 2, 4 … minutter). Fejler
alle forsøg, står hændelsen under **Hændelser → Fejlede leveringer** i
appen, hvor den kan sendes igen.

## Zapier

1. Opret en Zap. Vælg udløseren **Webhooks by Zapier → Catch Hook**.
2. Kopiér Zapiers adresse, og indsæt den i PREAURA under **Hændelser →
   Webhook**. Slå webhooken til.
3. Lav en testordre med en forudbestilling, så Zapier kan se felterne.
4. Tilføj et filter: **Only continue if** `type` _exactly matches_
   `preorder.ready` (eller den hændelse, Zappen skal reagere på).
5. Tilføj jeres mailsystem som næste trin, fx Mailchimp **Add/Update
   Subscriber** eller Brevo **Add or Update Contact**. Brug
   `customer.email` som e-mail. Sæt et tag eller en egenskab, der kan
   starte en automatisk mail, fx `preorder_ready`, og brug `deliveryDate`
   og `product.title` i mailens tekst.

## Make

1. Opret et scenarie med modulet **Webhooks → Custom webhook**, og kopiér
   adressen til PREAURA.
2. Klik **Redetermine data structure**, og lav en testordre.
3. Tilføj et filter på `type`, og fortsæt med jeres mailsystems modul.

## Tjek signaturen (valgfrit, anbefalet)

Signaturnøglen står i PREAURA under **Hændelser → Webhook**. Headeren
`X-Preaura-Hmac-Sha256` er HMAC-SHA256 af den rå tekst i kaldet med nøglen,
base64-kodet — samme metode som Shopifys egne webhooks.

Node.js:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function fromPreaura(rawBody, header, secret) {
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  return (
    expected.length === header.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(header))
  );
}
```

I Zapier kan det gøres i et **Code by Zapier**-trin. Beregn signaturen af den
rå tekst — ikke af JSON, der er læst og skrevet igen.

## Ansvar

Webhooken sender kundens navn og e-mail videre. Butikken er selv ansvarlig
for sit grundlag for at sende kundeoplysninger til en tredjepart (fx
Zapier, Make eller et mailsystem) og for sin aftale med dem. PREAURA sender
kun på butikkens instruks og er databehandler.
