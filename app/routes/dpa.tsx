import type { MetaFunction } from "react-router";

// Databehandleraftale (DPA) for PREAURA. Offentlig side (ingen login), som
// vilkårene og App Store-siden linker til: https://preaura.onrender.com/dpa
//
// UDKAST — skal gennemgås af en jurist, før det tages i brug.
//
// Som privatlivspolitikken skal teksten passe til, hvad koden faktisk gør.
// Ændres det, appen gemmer, sletter eller sender videre, skal Bilag A–C
// rettes med.

const PROCESSOR = {
  name: "LALATOTO of Denmark ApS",
  cvr: "45149218",
  address: "Kulbyvej 16, 4270 Høng, Danmark",
  email: "nicolaj@lalatoto.dk",
};

const UPDATED = "7. november 2026";

export const meta: MetaFunction = () => [
  { title: "Databehandleraftale – PREAURA" },
  { name: "robots", content: "index" },
];

const styles = {
  page: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "48px 20px 80px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    lineHeight: 1.6,
    color: "#202223",
    background: "#fff",
  },
  table: {
    borderCollapse: "collapse" as const,
    width: "100%",
    margin: "8px 0",
  },
  cell: {
    border: "1px solid #d2d5d8",
    padding: "8px 10px",
    verticalAlign: "top" as const,
    textAlign: "left" as const,
  },
  muted: { color: "#6d7175" },
  draft: {
    background: "#fff5ea",
    border: "1px solid #e8a33d",
    borderRadius: 8,
    padding: "12px 16px",
  },
};

function Cell({ children }: { children: React.ReactNode }) {
  return <td style={styles.cell}>{children}</td>;
}

export default function Dpa() {
  return (
    <main style={styles.page}>
      <h1>Databehandleraftale for PREAURA</h1>
      <p style={styles.muted}>Senest opdateret: {UPDATED}</p>

      <p style={styles.draft}>
        <strong>Udkast.</strong> Aftalen er endnu ikke gennemgået af en jurist
        og gælder ikke i sin nuværende form.
      </p>

      <h2>1. Parterne</h2>
      <p>
        <strong>Den dataansvarlige</strong> er den virksomhed, der har
        installeret appen PREAURA i sin Shopify-butik («webshoppen»).
      </p>
      <p>
        <strong>Databehandleren</strong> er {PROCESSOR.name}, CVR{" "}
        {PROCESSOR.cvr}, {PROCESSOR.address} («PREAURA»).
      </p>
      <p>
        Aftalen indgås, når webshoppen installerer appen, og er en del af
        vilkårene for brug af PREAURA. Den opfylder kravene i
        databeskyttelsesforordningens (GDPR) artikel 28, stk. 3.
      </p>

      <h2>2. Formål og omfang</h2>
      <p>
        PREAURA behandler personoplysninger på webshoppens vegne for at levere
        appens funktioner: at styre forudbestillinger, fordele dem på
        leverancer, holde webshoppens lager i Shopify ajour og — når webshoppen
        selv slår det til — sende hændelser om forudbestillingen til de
        modtagere, webshoppen vælger. Behandlingens art, formål, kategorier af
        oplysninger og registrerede står i Bilag A.
      </p>

      <h2>3. Webshoppens rettigheder og pligter</h2>
      <p>
        Webshoppen er ansvarlig for, at behandlingen sker lovligt, herunder at
        der er et gyldigt behandlingsgrundlag for at give PREAURA oplysningerne
        og for at sende dem videre til de modtagere, webshoppen selv slår til
        (fx Klaviyo eller en webhook-adresse). Webshoppen er også ansvarlig for
        sin egen aftale med disse modtagere.
      </p>

      <h2>4. PREAURA handler kun efter instruks</h2>
      <p>
        PREAURA behandler kun personoplysninger efter dokumenteret instruks fra
        webshoppen. Instruksen er denne aftale med Bilag C og de valg,
        webshoppen træffer i appen (fx hvilke modtagere der er slået til). Mener
        PREAURA, at en instruks strider mod databeskyttelsesreglerne,
        underretter PREAURA straks webshoppen.
      </p>

      <h2>5. Fortrolighed</h2>
      <p>
        Kun personer, der har brug for det for at levere og drive appen, har
        adgang til oplysningerne. De har tavshedspligt. Adgangen gennemgås
        løbende og fjernes, når den ikke længere er nødvendig.
      </p>

      <h2>6. Sikkerhed</h2>
      <p>
        PREAURA træffer passende tekniske og organisatoriske
        sikkerhedsforanstaltninger, jf. GDPR artikel 32. De er beskrevet i Bilag
        C.
      </p>

      <h2>7. Underdatabehandlere</h2>
      <p>
        Webshoppen giver med denne aftale generel tilladelse til, at PREAURA
        bruger de underdatabehandlere, der står i Bilag B. PREAURA giver
        webshoppen besked mindst 30 dage før, en underdatabehandler tilføjes
        eller udskiftes, så webshoppen kan gøre indsigelse. PREAURA pålægger
        underdatabehandlere de samme databeskyttelsesforpligtelser som i denne
        aftale og hæfter over for webshoppen for deres overholdelse.
      </p>
      <p>
        Modtagere, som webshoppen selv vælger og slår til i appen (fx Klaviyo
        eller en webhook-adresse), er ikke PREAURAs underdatabehandlere. PREAURA
        sender kun til dem på webshoppens instruks.
      </p>

      <h2>8. Overførsel til tredjelande</h2>
      <p>
        Oplysningerne opbevares i EU (Frankfurt, Tyskland). Overføres de til et
        land uden for EU/EØS, sker det kun efter webshoppens instruks og med et
        gyldigt overførselsgrundlag efter GDPR kapitel V.
      </p>

      <h2>9. Bistand til webshoppen</h2>
      <p>
        PREAURA hjælper webshoppen med at opfylde de registreredes rettigheder
        (indsigt, berigtigelse, sletning m.m.):
      </p>
      <ul>
        <li>
          <strong>Indsigt:</strong> Når Shopify sender en kundes anmodning om
          indsigt, viser appen under «Ordrebehandling», hvad PREAURA har om
          kundens ordrer og kundens tilmeldinger til ventelisten.
        </li>
        <li>
          <strong>Sletning:</strong> Når Shopify sender en anmodning om sletning
          af en kunde, sletter PREAURA kundens navn og e-mail i hændelser,
          kundens tilmeldinger til ventelisten, kundens indsigtsanmodninger og
          beskeder om kundens ordrer. Tildelingerne (ordrenummer, antal og dato)
          bevares, fordi de er webshoppens regnskab over pladserne i
          leverancerne og ikke indeholder kundens navn eller kontaktoplysninger.
        </li>
      </ul>
      <p>
        PREAURA bistår desuden med sikkerhed, underretning om brud,
        konsekvensanalyser og forudgående høring, jf. GDPR artikel 32–36.
      </p>

      <h2>10. Brud på persondatasikkerheden</h2>
      <p>
        PREAURA underretter webshoppen uden unødig forsinkelse og senest 48
        timer efter at være blevet opmærksom på et brud, så webshoppen kan
        anmelde det til Datatilsynet inden for 72 timer. Underretningen
        beskriver så vidt muligt bruddets karakter, de berørte kategorier og
        omtrentlige antal registrerede og oplysninger, de sandsynlige
        konsekvenser og de foranstaltninger, der er truffet.
      </p>

      <h2>11. Sletning ved ophør</h2>
      <p>
        Afinstallerer webshoppen appen, sletter PREAURA alle webshoppens
        oplysninger, når Shopify giver besked om det (48 timer efter
        afinstallationen). Webshoppens egne data i Shopify, fx ordrer og den
        lovede leveringsdato på ordren, bliver i Shopify.
      </p>

      <h2>12. Revision og tilsyn</h2>
      <p>
        PREAURA stiller de oplysninger til rådighed, der er nødvendige for at
        vise, at aftalen overholdes, og giver mulighed for revision, herunder
        inspektion foretaget af webshoppen eller en revisor, som webshoppen har
        bemyndiget. Rimelige omkostninger ved revision afholdes af webshoppen.
      </p>

      <h2>13. Ikrafttræden og ophør</h2>
      <p>
        Aftalen gælder, så længe PREAURA behandler personoplysninger for
        webshoppen. Den kan ikke opsiges, så længe behandlingen fortsætter.
        Ændringer i Bilag A–C meddeles webshoppen.
      </p>

      <h2>14. Kontakt</h2>
      <p>
        {PROCESSOR.name},{" "}
        <a href={`mailto:${PROCESSOR.email}`}>{PROCESSOR.email}</a>
      </p>

      <h2>Bilag A — Oplysninger om behandlingen</h2>
      <table style={styles.table}>
        <tbody>
          <tr>
            <Cell>
              <strong>Formål</strong>
            </Cell>
            <Cell>
              Styre forudbestillinger og leverancer, holde lageret i Shopify
              ajour, skrive den lovede leveringsdato på ordren, og — når
              webshoppen slår det til — sende hændelser om forudbestillingen
              (oprettet, forsinket, klar til afsendelse, annulleret) til de
              modtagere, webshoppen vælger. Når webshoppen slår ventelisten til:
              modtage kunders tilmelding til besked om en udsolgt vare og sende
              hændelsen «varen kan købes» til de samme modtagere, så webshoppen
              kan give kunden besked. Ventelisten bruges ikke til markedsføring
              eller nyhedsbrev.
            </Cell>
          </tr>
          <tr>
            <Cell>
              <strong>Registrerede</strong>
            </Cell>
            <Cell>
              Webshoppens kunder, der forudbestiller en vare eller skriver sig
              på ventelisten til en udsolgt vare.
            </Cell>
          </tr>
          <tr>
            <Cell>
              <strong>Kategorier af oplysninger</strong>
            </Cell>
            <Cell>
              Almindelige personoplysninger: ordrenummer og -id, antal,
              bestillingstidspunkt og lovet leveringsdato. Kun ved udsendelse af
              hændelser desuden kundens navn og e-mail. Ved tilmelding til
              ventelisten: kundens e-mail, produkt, variant og tidspunkt. Ingen
              følsomme oplysninger, ingen betalingsoplysninger, ingen adresser
              eller telefonnumre.
            </Cell>
          </tr>
          <tr>
            <Cell>
              <strong>Varighed</strong>
            </Cell>
            <Cell>
              Så længe appen er installeret. Kundens navn og e-mail i hændelser
              slettes efter 30 dage. Tilmeldinger til ventelisten slettes 7 dage
              efter, kunden har fået besked, og senest efter 180 dage. Se Bilag
              C.
            </Cell>
          </tr>
        </tbody>
      </table>

      <h2>Bilag B — Underdatabehandlere</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.cell}>Underdatabehandler</th>
            <th style={styles.cell}>Behandling</th>
            <th style={styles.cell}>Placering</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Render Services, Inc.</Cell>
            <Cell>Hosting af appen og databasen</Cell>
            <Cell>
              Frankfurt, Tyskland (EU). Overførselsgrundlag for eventuel adgang
              fra USA: [skal bekræftes af jurist]
            </Cell>
          </tr>
        </tbody>
      </table>

      <h2>Bilag C — Instruks og sikkerhed</h2>
      <h3>Behandling</h3>
      <ul>
        <li>
          Shopify sender ordren til appen. Kundens navn, e-mail og adresse i
          beskeden smides væk med det samme; kun ordrens id og tidspunkt gemmes.
        </li>
        <li>
          Kundens navn og e-mail hentes kun fra Shopify, når en hændelse skal
          sendes til en modtager, webshoppen har slået til.
        </li>
        <li>
          Annullering: kunden kan annullere via et signeret link uden login.
          PREAURA retter eller annullerer ordren i Shopify uden refundering;
          webshoppen refunderer selv. Ved afvist betaling ved afsendelse
          frigives enhederne efter webshoppens frist.
        </li>
        <li>
          Ventelisten: kunden skriver selv sin e-mail på produktsiden. Den
          bruges kun til én besked om, at netop den vare kan købes. Der er ingen
          afkrydsningsfelter, og tilmeldingen er ikke en tilmelding til
          nyhedsbrev. Hver tilmelding giver højst én besked.
        </li>
      </ul>
      <h3>Opbevaring og sletning</h3>
      <ul>
        <li>Beskeder fra Shopify (kun ordrens id og tidspunkt): 30 dage.</li>
        <li>Kundens navn og e-mail i hændelser: højst 30 dage.</li>
        <li>
          Tilmelding til ventelisten (e-mail, produkt, variant, tidspunkt): 7
          dage efter, kunden har fået besked. En tilmelding, der aldrig bliver
          udløst, slettes efter 180 dage.
        </li>
        <li>
          Antal, der har fået besked pr. vare og leverance (kun tal, ingen
          persondata): så længe appen er installeret.
        </li>
        <li>Logbog over sendte hændelser (uden kundeoplysninger): 90 dage.</li>
        <li>Besvarede indsigtsanmodninger: 30 dage.</li>
        <li>
          Annulleringer og afviste betalinger (ordrens id og nummer, linjer,
          antal og tidspunkter — ingen betalingsoplysninger): 90 dage efter,
          sagen er afsluttet.
        </li>
        <li>Alt om webshoppen: 48 timer efter afinstallation.</li>
      </ul>
      <h3>Sikkerhed</h3>
      <ul>
        <li>Al trafik er krypteret med HTTPS.</li>
        <li>
          Databasen ligger i EU, er krypteret og kan ikke nås fra internettet.
        </li>
        <li>
          Kundens navn og e-mail, API-nøgler og webhook-adresser krypteres
          desuden af appen selv (AES-256-GCM), før de gemmes.
        </li>
        <li>
          Tilmeldinger til ventelisten kommer gennem Shopify, som signerer dem.
          Antallet pr. afsender er begrænset, og svaret er det samme, uanset om
          e-mailen allerede står på listen. Afsenderens IP-adresse gemmes ikke.
        </li>
        <li>Beskeder fra Shopify kontrolleres med en digital signatur.</li>
        <li>Hver webshop kan kun se sine egne data.</li>
        <li>
          Test og produktion er adskilt: hver sin app, server og database. Data
          kopieres aldrig mellem dem.
        </li>
      </ul>
    </main>
  );
}
