# 2.1 Test af leverancestyring, status efter opgave 16

«Kode» betyder, at en automatisk test dækker punktet hele vejen gennem
ordrekøen mod en rigtig PostgreSQL og en simuleret Shopify. Testene kører med
`npm run test:leverancer` (kun leverancer) eller `npm test` (alt), og ved hvert
push i GitHub Actions. «Hånd» betyder, at noget stadig skal ses eller klikkes
i en rigtig butik, fordi det afhænger af Shopify selv, temaet eller browseren.

| # | Punkt | Status | Hvor |
| --- | --- | --- | --- |
| 1 | Produkt med 150 til 1. januar og 150 til 15. januar | Kode | `app/orders/deliveryControl.test.ts`, «grundscenariet: 150 + 150» |
| 2 | De første 150 i første leverance | Kode | Samme test, alle 300 ordrer tjekkes en for en |
| 3 | Ordre 151 i anden leverance | Kode | Samme test, også datoen på ordren i Shopify |
| 4 | Datoen skifter på produktsiden efter skiftet | Kode og hånd | Data til produktsiden: samme test. Blokkens visning: `theme-extension-src/live-block.test.ts`. Hånd: se det i et rigtigt tema |
| 5 | Forudbestilling stopper efter 300 | Kode | Samme test: lager 0 med «sælg ikke», ingen plan, ordre 301 får ingen plads |
| 6 | Samme situation med flere varianter | Kode (mindre tal) | «varianter har hver sin leveranceplan», med 2 varianter og små antal |
| 7 | Én variant udsolgt i leverance 1, andre stadig til salg | Kode | Samme test |
| 8 | Flere enheder end der er tilbage | Kode | «flere enheder end der er tilbage» |
| 9 | To kunder køber den sidste enhed samtidig | Kode og hånd | «to køb af den sidste enhed på samme tid»: køens lås og databasens lås. Hånd: to rigtige checkouts samtidig, som rammer Shopifys eget lager |
| 10 | Annullering af en ordre fra første leverance | Kode | `processQueue.server.test.ts` og `app/release/release.test.ts` (fuld, delvis, præcis én gang) |
| 11 | Ændret antal på en oprettet ordre | Kode | `processQueue.server.test.ts`, «et ændret antal regnes rigtigt» |
| 12 | Manuel ændring af leverancedato | Kode og hånd | `deliveryControl.test.ts` («ændret leverancedato») og `syncVariant.server.test.ts`. Hånd: ret datoen i admin og se resultatet |
| 13 | Manuel ændring af leveranceantal | Kode og hånd | `syncVariant.server.test.ts` («et rettet antal»), `preorder.server.test.ts` (ikke under det tildelte). Hånd: ret antallet i admin |
| 14 | En leverance bliver forsinket | Kode | `app/events/events.test.ts` («forsinket»), og datoen på afgivne ordrer står fast |
| 15 | En leverance modtages tidligere | Kode og hånd | `events.test.ts` («klar til afsendelse» ved lager og knappen), `variantMode.test.ts`. Hånd: læg varer på lager i Shopify og se skiftet |
| 16 | Genindlæsning af produktsiden under et datoskift | Hånd (delvis kode) | `live-block.test.ts` («siden følger med, når leverancen bliver udsolgt»). Hånd: genindlæs i en rigtig browser, mens skiftet sker |
| 17 | Ændringer i Shopify-lageret uden for appen | Kode | «lagerændringer uden for appen», inkl. fejlen fra opgave 4 |

## Kræver stadig en hånd på musen

1. **Punkt 4:** datoen på produktsiden i et rigtigt tema efter skiftet.
2. **Punkt 9:** to rigtige checkouts af den sidste enhed på samme tid.
3. **Punkt 12 og 13:** ret dato og antal i admin og se, at produktsiden følger med.
4. **Punkt 15:** læg varer på lager i Shopify før tid og se skiftet til lager.
5. **Punkt 16:** genindlæs produktsiden, mens leverance 1 bliver udsolgt.
6. **Punkt 6 i fuld størrelse:** 150 + 150 på flere varianter, hvis det skal ses med rigtige tal.

## Fejl fundet under opgave 16

To samtidige afstemninger kunne give den sidste enhed til to kunder, så
leverancen endte på minus én (hvis køens lås udløb midt i en behandling).
Rettet med en lås i databasen i `orders.apply`.
