import type { MetaFunction } from "react-router";

// Privatlivspolitik for PREAURA. Offentlig side (ingen login), som App
// Store-siden linker til: https://preaura.onrender.com/privacy
//
// Teksten skal passe til, hvad koden faktisk gør. Ændres det, appen gemmer
// eller sletter (prisma/schema.prisma, app/lib/webhookPayload.ts,
// app/models/compliance.server.ts), skal siden rettes med.

const COMPANY = {
  name: "LALATOTO of Denmark ApS",
  cvr: "45149218",
  address: "Kulbyvej 16, 4270 Høng",
  email: "nicolaj@lalatoto.dk",
};

const UPDATED = "4. november 2026";

export const meta: MetaFunction = () => [
  { title: "Privatlivspolitik – PREAURA" },
  { name: "robots", content: "index" },
];

const styles = {
  page: {
    maxWidth: 720,
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
};

function Row({ what, why, how }: { what: string; why: string; how: string }) {
  return (
    <tr>
      <td style={styles.cell}>{what}</td>
      <td style={styles.cell}>{why}</td>
      <td style={styles.cell}>{how}</td>
    </tr>
  );
}

export default function Privacy() {
  return (
    <main style={styles.page}>
      <h1>Privatlivspolitik for PREAURA</h1>
      <p style={styles.muted}>Senest opdateret: {UPDATED}</p>

      <p>
        PREAURA er en app til Shopify, der lader webshops sælge varer på
        forudbestilling med leverancer og leveringsdatoer. Denne politik
        forklarer, hvilke oplysninger appen behandler, hvorfor, hvor længe de
        gemmes, og hvilke rettigheder du har.
      </p>

      <h2>1. Hvem står bag</h2>
      <p>
        {COMPANY.name}
        <br />
        CVR: {COMPANY.cvr}
        <br />
        {COMPANY.address}
        <br />
        E-mail: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
      </p>
      <p>
        Over for <strong>webshoppens kunder</strong> er webshoppen
        dataansvarlig, og {COMPANY.name} er databehandler på vegne af
        webshoppen. Over for <strong>webshoppen selv</strong> (butikken, der
        installerer appen) er {COMPANY.name} dataansvarlig for de oplysninger,
        der er nødvendige for at levere appen.
      </p>

      <h2>2. Kort fortalt</h2>
      <ul>
        <li>
          PREAURA gemmer <strong>ingen</strong> navne, e-mailadresser,
          telefonnumre, adresser eller betalingsoplysninger om webshoppens
          kunder.
        </li>
        <li>
          Om en ordre gemmes kun det, der skal til for at holde styr på
          pladserne i leverancerne: ordrens id og nummer, antal, tidspunkt og
          den lovede dato.
        </li>
        <li>
          Data ligger krypteret på servere i EU (Frankfurt) og slettes, når
          appen afinstalleres.
        </li>
        <li>Der bruges ingen sporings- eller markedsføringscookies.</li>
      </ul>

      <h2>3. Hvilke oplysninger behandles</h2>
      <h3>Om webshoppen</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.cell}>Oplysning</th>
            <th style={styles.cell}>Formål</th>
            <th style={styles.cell}>Opbevaring</th>
          </tr>
        </thead>
        <tbody>
          <Row
            what="Butikkens Shopify-domæne og adgangsnøgle til Shopify"
            why="Logge ind og læse og skrive produkter, lager og ordrer på butikkens vegne"
            how="Så længe appen er installeret"
          />
          <Row
            what="Indstillinger, valgte produkter og varianter, leverancer (dato og antal) og historik over skift mellem lager og forudbestilling"
            why="Levere appens funktioner"
            how="Så længe appen er installeret"
          />
        </tbody>
      </table>

      <h3>Om webshoppens ordrer og kunder</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.cell}>Oplysning</th>
            <th style={styles.cell}>Formål</th>
            <th style={styles.cell}>Opbevaring</th>
          </tr>
        </thead>
        <tbody>
          <Row
            what="Tildelinger: ordrens id og nummer (fx #1042), ordrelinjens id, variant, antal, bestillingstidspunkt, leverance og lovet dato"
            why="Fordele forudbestillinger på leverancer i den rækkefølge, kunderne bestilte, og undgå oversalg"
            how="Så længe appen er installeret. Bevares også ved en kundes anmodning om sletning, fordi de ikke indeholder personoplysninger og er butikkens regnskab over pladserne"
          />
          <Row
            what="Kø over beskeder fra Shopify (webhooks): kun ordrens id og tidspunkt eller lagervarens id"
            why="Behandle ordrer og lagerændringer i den rigtige rækkefølge"
            how="Slettes 30 dage efter behandling"
          />
          <Row
            what="En kundes anmodning om indsigt: Shopifys id på kunden og på de ordrer, anmodningen gælder"
            why="Vise webshoppen, hvad appen har om kundens ordrer, så webshoppen kan svare kunden"
            how="Slettes 30 dage efter, webshoppen har markeret den som besvaret, eller når kunden skal slettes"
          />
        </tbody>
      </table>
      <p>
        Når Shopify sender en ordre til appen, indeholder beskeden også kundens
        navn, e-mail og adresse. De oplysninger smides væk med det samme og
        gemmes aldrig. Appen læser selv ordrens linjer fra Shopify uden
        kundeoplysninger.
      </p>
      <p>
        Appen skriver den lovede leveringsdato og et tag («Forudbestilling») på
        ordren i webshoppens Shopify. Det bliver i Shopify og er en del af
        webshoppens egne data.
      </p>

      <h2>4. Retsgrundlag</h2>
      <p>
        Behandlingen af webshoppens oplysninger sker for at opfylde aftalen om
        brug af appen (GDPR art. 6, stk. 1, litra b). Behandlingen af
        oplysninger om webshoppens ordrer sker på webshoppens vegne og efter
        dens instruks som databehandler (GDPR art. 28).
      </p>

      <h2>5. Hvem oplysningerne deles med</h2>
      <p>Oplysninger sælges eller deles aldrig til markedsføring.</p>
      <ul>
        <li>
          <strong>Shopify</strong> — appen kører i Shopify og udveksler data med
          webshoppens Shopify-konto.
        </li>
        <li>
          <strong>Render Services, Inc.</strong> — hosting af appen og databasen
          på servere i Frankfurt, Tyskland. Render er underdatabehandler.
        </li>
      </ul>

      <h2>6. Sikkerhed</h2>
      <ul>
        <li>Al trafik er krypteret med HTTPS.</li>
        <li>Databasen er krypteret og kan ikke nås fra internettet.</li>
        <li>
          Beskeder fra Shopify kontrolleres med en digital signatur, før de
          behandles.
        </li>
        <li>Hver butik kan kun se sine egne data.</li>
      </ul>

      <h2>7. Sletning</h2>
      <ul>
        <li>
          Når en kunde beder webshoppen om at blive slettet, sletter appen
          kundens anmodninger og beskeder om kundens ordrer.
        </li>
        <li>
          Afinstalleres appen, sletter appen alle butikkens data 48 timer
          senere, når Shopify giver besked om det.
        </li>
      </ul>

      <h2>8. Dine rettigheder</h2>
      <p>
        Du har ret til indsigt, berigtigelse, sletning, begrænsning og
        indsigelse samt til at få dine data udleveret (dataportabilitet).
      </p>
      <p>
        <strong>Er du kunde i en webshop,</strong> skal du kontakte webshoppen.
        Webshoppen er dataansvarlig, og appen viser den, hvad PREAURA har om
        dine ordrer.
      </p>
      <p>
        <strong>Er du webshop,</strong> kan du skrive til{" "}
        <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
      </p>
      <p>
        Du kan klage til Datatilsynet, Carl Jacobsens Vej 35, 2500 Valby,{" "}
        <a href="https://www.datatilsynet.dk">www.datatilsynet.dk</a>.
      </p>

      <h2>9. Cookies</h2>
      <p>
        PREAURA bruger kun det, der er teknisk nødvendigt for at logge
        webshoppen sikkert ind gennem Shopify. Der bruges ingen sporings-,
        analyse- eller markedsføringscookies. Appens blok på produktsiden sætter
        ingen cookies.
      </p>

      <h2>10. Ændringer</h2>
      <p>
        Ændres politikken, opdateres datoen øverst. Ved væsentlige ændringer
        giver vi webshoppen besked.
      </p>
    </main>
  );
}
