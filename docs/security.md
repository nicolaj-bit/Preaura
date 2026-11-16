# PREAURA — sikkerhed og plan for sikkerhedshændelser

Gælder for appen PREAURA, leveret af LALATOTO of Denmark ApS (CVR 45149218).
Ansvarlig for sikkerheden: Nicolaj Baudtler (nicolaj@lalatoto.dk).

Dokumentet dækker Shopifys krav til beskyttede kundedata (level 2) og det,
databehandleraftalen (`/dpa`) lover webshoppen. Ændres noget her, skal det
stemme med aftalen og privatlivspolitikken (`/privacy`).

Senest gennemgået: 16. november 2026. Gennemgås mindst én gang om året og
efter hver sikkerhedshændelse.

---

## 1. Hvilke persondata appen behandler

- **Kundens navn og e-mail** i udgående hændelser (Flow, webhook, Klaviyo):
  hentes fra Shopify, gemmes krypteret og slettes efter højst 30 dage.
- **E-mail på ventelisten:** gemmes krypteret; slettes 7 dage efter, kunden
  har fået besked, og senest efter 180 dage.
- **Ordrens id og nummer, antal, pris pr. stk. og lovet dato** i
  tildelingerne — ingen navne, adresser eller betalingsoplysninger. Prisen
  bruges kun til oversigtens beløb på forsiden.

Alt om en butik slettes 48 timer efter afinstallation (shop/redact).

## 2. Tekniske og organisatoriske foranstaltninger

| Krav (Shopify, level 2) | Sådan opfylder PREAURA det |
| --- | --- |
| Kryptering under transport | Al trafik er HTTPS. |
| Kryptering i hvile | Databasen hos Render er krypteret. Navn, e-mail, API-nøgler og webhook-adresser krypteres desuden af appen selv (AES-256-GCM) med `PREAURA_ENCRYPTION_KEY`, som kun findes som miljøvariabel på Render. |
| Krypterede backups | Renders backups af databasen (se tjekliste nedenfor). |
| Adskilt test og produktion | To apps, to servere, to databaser, egne nøgler. Data kopieres aldrig mellem dem (`AGENTS.md`). |
| Undgå datatab | Ingen data slettes ved udløbet abonnement. Hændelser prøves igen med voksende ventetid og står i admin, hvis de fejler. Køen gemmer kun ordrens id. |
| Begrænset adgang for medarbejdere | Kun den ansvarlige har adgang til Render, databasen, GitHub og Partner Dashboard. Ingen adgang deles. |
| Stærke adgangskoder | Lange, unikke adgangskoder i en adgangskodemanager og totrinsbekræftelse på alle konti (se tjekliste). |
| Log over adgang til persondata | Tabellen `AccessLog` (se afsnit 3). |
| Plan for sikkerhedshændelser | Afsnit 4. |

### Tjekliste — kontrolleres ved hver gennemgang

- [ ] Totrinsbekræftelse er slået til på: Shopify Partner/Dev Dashboard,
      Render, GitHub og den e-mail, de bruger.
- [ ] Ingen andre end den ansvarlige har adgang til Render-projektet og
      GitHub-repoet (eller adgangen er begrundet og noteret her).
- [ ] Render-databasen `preaura-db` har automatiske backups, og de er
      krypterede (se Renders dokumentation for den aktuelle plan).
- [ ] Hemmeligheder (`SHOPIFY_API_SECRET`, `PREAURA_ENCRYPTION_KEY`,
      `SHOPIFY_PARTNER_API_ACCESS_TOKEN`) står kun på Render — aldrig i
      repoet, i chat eller i e-mail.
- [ ] Adgangsloggen skrives (se en nylig post, fx med en dataanmodning i
      testbutikken).

## 3. Adgangslog

Appen logger hver gang den:

- henter kundens navn og e-mail fra Shopify til en hændelse
  (`read_customer_contact`),
- dekrypterer en hændelse med kundens navn og e-mail for at sende den
  (`decrypt_event_payload`),
- dekrypterer en e-mail på ventelisten for at give besked
  (`decrypt_waitlist_email`),
- gemmer en kundes data til en dataanmodning (`export_customer_data`), og når
  butikken ser dataanmodningen i appen (`view_data_request`, actor `admin`),
- sletter en kundes data (`erase_customer`).

Hver post har butik, tidspunkt, hvem (`system` eller `admin`), handling,
ressource (ordrens, hændelsens eller tilmeldingens id) og formål. Loggen
indeholder **ingen persondata**. Den gemmes i 365 dage og slettes med
butikken ved shop/redact. Koden står i `app/models/accessLog.server.ts`.

Direkte adgang til databasen (Render-konsol eller -shell) logges ikke af
appen. Den bruges kun ved en sikkerhedshændelse eller fejlsøgning, som
noteres i hændelsesloggen (afsnit 4.6).

## 4. Plan for sikkerhedshændelser

En sikkerhedshændelse er alt, der kan have givet uvedkommende adgang til
persondata eller hemmeligheder, eller har ført til, at data er gået tabt
eller ændret — fx en lækket nøgle, en fejl der viser én butiks data til en
anden, mistænkelig aktivitet på en konto eller et angreb på serveren.

### 4.1 Opdag og registrér (straks)

- Skriv tidspunkt, hvad der er set, og hvem der opdagede det, i
  hændelsesloggen (4.6).
- Kilder: Renders logge og hændelser, fejl i appens admin (Ordrebehandling,
  Hændelser), henvendelser fra butikker, Shopify eller kunder, advarsler fra
  GitHub (fx lækkede nøgler).

### 4.2 Begræns (inden for få timer)

Vælg det, der passer:

- **Lækket Shopify client secret:** rotér den i Dev Dashboard, opdatér
  `SHOPIFY_API_SECRET` på Render, og udrul.
- **Lækket Partner API-nøgle:** slet klienten i Partner Dashboard, opret en
  ny, og opdatér `SHOPIFY_PARTNER_API_ACCESS_TOKEN`.
- **Lækket `PREAURA_ENCRYPTION_KEY`:** behandl alle krypterede felter som
  kompromitterede. En ny nøgle gør de gamle data ulæselige — hændelser
  (højst 30 dage) og ventelister må genopbygges, og butikkerne skal indtaste
  Klaviyo-nøgle og webhook-adresse igen.
- **Kompromitteret konto (Render, GitHub, Shopify):** skift adgangskode,
  log alle sessioner ud, tjek totrinsbekræftelse og kontoens historik.
- **Fejl i koden, der viser eller sender forkerte data:** stop funktionen
  (fx slå udgående hændelser fra for de berørte butikker), ret fejlen, og
  udrul.
- **Angreb på serveren:** sæt tjenesten på pause i Render, hvis det er
  nødvendigt for at stoppe det.

### 4.3 Vurdér (inden for 24 timer)

- Hvilke butikker og hvilke data er berørt? Brug adgangsloggen og Renders
  logge.
- Er det et brud på persondatasikkerheden (persondata kan være set, ændret,
  slettet eller mistet)? Er der risiko for de registrerede?

### 4.4 Underret

- **Webshopperne:** uden unødig forsinkelse og **senest 48 timer** efter, vi
  er blevet opmærksomme på bruddet (databehandleraftalens punkt 10), så
  butikken kan anmelde det til Datatilsynet inden for 72 timer. Beskriv så
  vidt muligt: hvad der er sket, hvilke kategorier af data og hvor mange
  kunder, sandsynlige følger, og hvad vi har gjort og anbefaler.
  Mangler oplysninger, sendes de, så snart de findes.
- **Shopify:** hvis bruddet angår data fra Shopify, efter Shopifys
  partnervilkår og retningslinjer (via Partner Dashboard / Shopifys
  partnersupport).
- **Datatilsynet:** kun hvis LALATOTO selv er dataansvarlig for de berørte
  data (fx egne kontooplysninger), inden for 72 timer.
- **De registrerede (kunderne):** det er webshoppens opgave som dataansvarlig;
  PREAURA hjælper med oplysningerne.

### 4.5 Ret og lær (inden for 14 dage)

- Ret årsagen, og tilføj en test, der fanger den fremover.
- Gennemgå dette dokument og tjeklisten.
- Skriv en kort efterbehandling i hændelsesloggen: forløb, årsag, hvad der
  er ændret.

### 4.6 Hændelseslog

Føres her (eller i et dokument, der henvises til). Én linje pr. hændelse:
dato, kort beskrivelse, berørte butikker, hvornår webshopperne og Shopify er
underrettet, og hvad der er rettet.

| Dato | Hændelse | Berørte | Underrettet | Rettet |
| --- | --- | --- | --- | --- |
| — | Ingen hændelser endnu. | — | — | — |
