# Drift: sikkerhedskopier, gendannelse og alarmer

Opgave 17. Gælder produktionen (`preaura`, `preaura-db`) og testmiljøet
(`preaura-test`, `preaura-test-db`) hver for sig. Data kopieres aldrig mellem
dem (`AGENTS.md`).

## Plan og dvale

- **Tjenesten** kører på Renders betalte plan **Starter** (`render.yaml`,
  `plan: starter`). Ifølge Renders dokumentation (render.com/docs/free) går
  kun **Free**-tjenester i dvale efter 15 minutter uden trafik. Starter går
  ikke i dvale, så webhooks bliver ikke forsinket af opvågning.
- **Databasen** kører på den betalte plan **Basic-256mb**.
- Tjek én gang i Render, at «Instance Type» står til Starter på begge
  tjenester. `render.yaml` er opskriften, men det er dashboardet, der gælder.
- Under en udrulning eller genstart kan et webhook-kald fejle i nogle
  sekunder. Shopify prøver selv igen (flere gange over 48 timer), og appen
  gemmer hændelsen i køen, før den svarer. Ingen hændelse tabes ved en
  genstart, og den periodiske fejning tager det, der ligger i køen.

## Hvad der sikkerhedskopieres

Hele appens database, dvs. alle appens egne data om alle butikker:
leverancer, tildelinger, varianter og deres tilstand, ventelister,
butiksindstillinger, integrationer, annulleringer, afviste betalinger, kø,
dataanmodninger og adgangslog.

Abonnementet gemmes ikke i appen. Det ligger hos Shopify og læses derfra
hver gang, så det skal ikke sikkerhedskopieres. Det samme gælder ordrer,
produkter og lager.

## Hvor ofte og hvor længe

Render sikkerhedskopierer betalte databaser **løbende** (point-in-time
recovery). Man kan gendanne til et vilkårligt tidspunkt inden for:

| Render-arbejdsområde | Gendannelsesvindue |
| --- | --- |
| Hobby | de seneste 3 dage |
| Pro eller højere | de seneste 7 dage |

Ældre tilstande findes ikke. Kopierne rulles altså over efter højst 7 dage.

Render kan også lave manuelle eksporter (Recovery → Create export). De
opbevares hos Render i 7 dage. **Regel:** en eksport må ikke downloades og
gemmes andre steder, for så holder løftet om sletning ikke (se nedenfor).
Downloades en til fejlsøgning, slettes den samme dag.

## Kryptering

Render krypterer databasen med AES-256 i hvile, og det gælder også alle
sikkerhedskopier (render.com/docs/postgresql-creating-connecting,
«Encryption»). Forbindelser udefra er altid TLS. Kundens navn og e-mail og
butikkernes nøgler er desuden krypteret af appen selv (AES-256-GCM med
`PREAURA_ENCRYPTION_KEY`), så de også er krypteret inde i kopien.

## Gendannelse af hele databasen

Bruges kun, hvis hele databasen er tabt eller ødelagt.

1. Render → databasen → **Recovery** → **Point-in-Time Recovery** →
   «Restore Database». Vælg tidspunktet, og giv den nye database et navn.
   Render laver en **ny** database; den gamle røres ikke.
2. Ret `DATABASE_URL` på tjenesten til den nye database, og udrul.
3. Gamle hændelser i køen og kundesletninger efter tidspunktet genudføres
   som beskrevet nedenfor (kør gendannelsen pr. butik for hver butik, eller
   sæt køen i gang igen).

## Gendannelse af én butik

Det realistiske uheld: én butiks data bliver ødelagt af en fejl. De andre
butikker må ikke rulles tilbage. Det gøres med `scripts/restore-shop.mjs`:

1. Render → databasen → Recovery → «Restore Database» til et tidspunkt før
   fejlen. Navngiv den fx `preaura-db-gendannet`. Det er **kilden**.
2. Render → tjenesten → **Shell**. Prøvekør (ændrer intet):

   ```
   SOURCE_DATABASE_URL='<kildens Internal Database URL>' \
     node scripts/restore-shop.mjs --shop butik.myshopify.com \
     --since 2026-11-17T08:00:00Z
   ```

   `--since` er tidspunktet, kopien er fra. Svaret viser, hvor mange rækker
   der gendannes pr. tabel.
3. Kør det samme med `--apply` til sidst.
4. Slet kilden i Render, når det er tjekket (den koster penge, mens den
   findes, og den er en kopi med persondata).

Hvad scriptet gør, i én transaktion (fejler noget, er intet ændret):

- Sletter butikkens rækker i appens egne tabeller og indsætter dem fra
  kopien: indstillinger, varianter, tilstandsskift, leverancer, selling
  plan-referencer, tildelinger, integrationer, udgående hændelser,
  venteliste, annulleringer og afviste betalinger.
- Rører ikke andre butikker, og rører ikke butikkens session, kø,
  dataanmodninger eller adgangslog.
- Sætter butikkens ordre- og lagerhændelser modtaget efter `--since` i kø
  igen. Køen læser hver ordre frisk fra Shopify og afstemmer, så ordrer
  efter kopien kommer med igen.
- Sætter alle butikkens kundesletninger (customers/redact) i kø igen, så
  data, der er slettet efter kopien, slettes igen.
- Nægter at gendanne en butik, der ikke har appen installeret, eller som
  er ved at blive slettet (shop/redact). En slettet butik kommer aldrig
  tilbage fra en kopi.

Ændringer, butikken selv har lavet i appen efter kopien (fx en ny
leverance), er ikke med og skal laves igen. Det skal butikken have at vide.

Testet i `app/maintenance/restoreShop.test.ts` mellem to rigtige
databaser: butik A gendannes, butik B rører sig ikke, ordrer og sletninger
efter kopien genudføres, og en fejl midt i gendannelsen efterlader målet
uændret.

## Sletning og sikkerhedskopier

Formulering til databehandleraftalen og privatlivspolitikken (skal godkendes
af juristen, før den sættes ind):

> Databasen sikkerhedskopieres løbende af vores hostingudbyder og krypteres
> med AES-256. Kopierne opbevares i højst 7 dage og overskrives derefter.
> Data, som PREAURA har slettet, kan derfor findes i en sikkerhedskopi i
> højst 7 dage efter sletningen. Kopierne bruges kun til at gendanne efter
> fejl. Gendannes data fra en kopi, slettes de data, der er blevet slettet
> efter kopiens tidspunkt, igen, før appen bruger dem.

Det er sandt, fordi: Render beholder højst 7 dage (3 på Hobby), eksporter
downloades ikke, og gendannelsen genudfører sletningerne fra køen (de
behandlede hændelser står i køen i 30 dage, altså længere end kopierne).

## Alarmer

Når noget går i stykker, sendes en kort besked til et menneske. Det sker
fra `app/lib/log.server.ts` ved:

- en ordre, en lagerændring eller en compliance-hændelse, der ikke kan
  behandles,
- en annullering eller frigivelse efter afvist betaling, der fejler,
- en synkronisering med Shopify, der fejler,
- en planlagt kørsel, der fejler (køen, ventelisten, udgående hændelser,
  sletning af gamle data, fejningen),
- adgangsloggen, der ikke kan skrives.

Højst én besked pr. slags fejl pr. butik pr. time. Beskeden indeholder
butikken, handlingen, id'er og fejlbeskeden, aldrig navne, e-mails eller
nyttelaster.

Opsætning (én gang pr. miljø):

1. Hent appen **ntfy** på telefonen, og abonnér på et emne med et langt,
   tilfældigt navn, fx `preaura-prod-` efterfulgt af 20 tilfældige tegn.
   Navnet er hemmeligt: alle, der kender det, kan læse beskederne.
2. Render → `preaura` → Environment → `PREAURA_ALERT_URL` =
   `https://ntfy.sh/<emnet>`. Gem. (Slack- eller Discord-webhooks virker
   også.)
3. Det samme for `preaura-test` med et andet emne.

Alarmerne kan kun sendes, mens appen kører. Er hele tjenesten nede, skal en
anden opdage det:

4. Opret en gratis overvågning hos fx UptimeRobot eller Better Stack af
   `https://preaura.onrender.com/healthz` hvert 5. minut med besked på
   e-mail. `/healthz` svarer 503, hvis databasen ikke kan nås.

## Logning og persondata

Alt, appen logger om fejl, går gennem `app/lib/log.server.ts`: én JSON-linje
med butik, handling, id'er og fejlens navn og besked. Aldrig hele
fejlobjektet (en fejl fra Shopifys GraphQL-klient bærer svaret med sig,
og et ordresvar kan indeholde kundens navn og e-mail), aldrig en
webhook-nyttelast, og e-mailadresser i en fejlbesked erstattes med
«[e-mail]». En test (`app/lib/log.server.test.ts`) fejler, hvis ny kode
skriver direkte til loggen udenom.
