# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

# Test og produktion — regler, der altid gælder

PREAURA har to miljøer, der ikke deler noget:

| | Produktion | Test |
| --- | --- | --- |
| App i Shopify | PREAURA (`shopify.app.toml`) | PREAURA Test (`shopify.app.test.toml`) |
| Server på Render | `preaura` | `preaura-test` |
| Database | `preaura-db` | `preaura-test-db` |
| Hemmeligheder | egne miljøvariabler | egne miljøvariabler |
| Butikker | rigtige butikker | kun udviklingsbutikker |

1. **Data kopieres aldrig fra produktion til test, og aldrig fra test til
   produktion.** Heller ikke «bare en enkelt ordre», heller ikke anonymiseret,
   heller ikke for at fejlsøge. Har du brug for testdata, så lav dem i
   testmiljøet. Begrundelse: adskilte test- og produktionsdata er et af
   Shopifys level 2-krav til beskyttede kundedata, og vi skal kunne svare ja
   til det uden forbehold.
2. **De to miljøer deler intet:** ikke database, ikke server, ikke
   krypteringsnøgle, ikke API-nøgle, ikke webhook-adresser.
3. **Alle nøgler og hemmeligheder ligger i miljøvariabler** på Render — aldrig
   i repoet, i en konfigurationsfil i git eller i en besked. Undtagelsen er
   appens client ID i `shopify.app*.toml`: Shopify CLI kræver den der, og den
   er offentlig (den sendes til browseren i Shopify Admin). Client secret er
   hemmelig og står kun i Render.
4. **Skift miljø med en kommando**, ikke ved at redigere filer:
   `npm run config:test` / `npm run config:prod`, og udrul med
   `npm run deploy:test` / `npm run deploy:prod`.
5. **Abonnementet (`app/billing/`) må aldrig røre data.** En udløbet
   prøveperiode eller en opsigelse lukker funktioner; den sletter eller
   nulstiller aldrig leverancer, tildelinger eller ordredata. Lint håndhæver
   det.
6. **Ét abonnement, ingen planer.** Adgang er enten «aktivt abonnement» eller
   «intet». Pris og prøveperiode står kun i Partner Dashboard. Byg ikke
   plannøgler, grænser eller planvælger ind igen uden en ny beslutning.
