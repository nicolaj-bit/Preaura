import type { MetaFunction } from "react-router";

// Handelsbetingelser (Terms of Service) for PREAURA. Offentlig side (ingen
// login), som App Store-siden linker til: https://preaura.onrender.com/terms
//
// På engelsk og dansk. Den engelske version gælder ved uoverensstemmelse
// (App Store-siden og de fleste butikker uden for Danmark er engelske).
//
// UDKAST — skal gennemgås af en jurist, før det tages i brug.
//
// Teksten skal passe til, hvad appen faktisk gør: ét abonnement uden planer,
// pris og prøveperiode i Shopify, ingen udbetalinger, ingen sletning ved
// udløbet abonnement, sletning 48 timer efter afinstallation.

const PROVIDER = {
  name: "LALATOTO of Denmark ApS",
  cvr: "45149218",
  address: "Kulbyvej 16, 4270 Høng, Denmark",
  addressDa: "Kulbyvej 16, 4270 Høng, Danmark",
  email: "nicolaj@lalatoto.dk",
};

const UPDATED = { en: "16 November 2026", da: "16. november 2026" };

export const meta: MetaFunction = () => [
  { title: "Terms of Service – PREAURA" },
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
  muted: { color: "#6d7175" },
  draft: {
    background: "#fff5ea",
    border: "1px solid #e8a33d",
    borderRadius: 8,
    padding: "12px 16px",
  },
  divider: { border: 0, borderTop: "1px solid #d2d5d8", margin: "56px 0" },
};

const Mail = () => <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a>;

export default function Terms() {
  return (
    <main style={styles.page}>
      <p style={styles.draft}>
        <strong>Draft / Udkast.</strong> These terms have not yet been reviewed
        by a lawyer and do not apply in their current form. Betingelserne er
        endnu ikke gennemgået af en jurist og gælder ikke i deres nuværende
        form.
      </p>
      <p>
        <a href="#en">English</a> · <a href="#da">Dansk</a>
      </p>

      <English />
      <hr style={styles.divider} />
      <Danish />
    </main>
  );
}

function English() {
  return (
    <section id="en" lang="en">
      <h1>PREAURA Terms of Service</h1>
      <p style={styles.muted}>Last updated: {UPDATED.en}</p>

      <h2>1. Who we are</h2>
      <p>
        PREAURA is provided by {PROVIDER.name}, company registration (CVR){" "}
        {PROVIDER.cvr}, {PROVIDER.address} («we», «us»). Contact: <Mail />.
      </p>

      <h2>2. Who these terms apply to</h2>
      <p>
        These terms apply to the business that installs PREAURA in its Shopify
        store («you», «the merchant»). PREAURA is a business tool. It is not
        offered to consumers. By installing or using PREAURA, you accept these
        terms on behalf of your business.
      </p>

      <h2>3. What PREAURA does</h2>
      <p>
        PREAURA lets you sell products on pre-order in your Shopify store. You
        create deliveries with an expected date and a quantity. PREAURA shows
        the date to your customers, reserves units per delivery, keeps orders
        and stock in step, and can let customers cancel, join a waitlist, and
        see in the cart that nothing is charged today. Features are described on
        our Shopify App Store listing.
      </p>

      <h2>4. Subscription, trial and payment</h2>
      <ul>
        <li>
          PREAURA has one subscription. The price and the length of the free
          trial are shown on the Shopify App Store listing and on Shopify’s plan
          page when you install.
        </li>
        <li>
          Billing is handled by Shopify and appears on your Shopify invoice.
          Shopify’s terms apply to the payment itself.
        </li>
        <li>
          You can cancel at any time in Shopify, or by uninstalling the app.
          Fees already charged are not refunded, except where Shopify’s billing
          rules or mandatory law say otherwise.
        </li>
        <li>
          We may change the price with at least 30 days’ notice. The change
          takes effect from your next billing period after the notice.
        </li>
      </ul>

      <h2>5. When the subscription ends</h2>
      <p>
        If the trial ends without a subscription, or you cancel, PREAURA’s
        features stop working. Your deliveries, reservations and order data are
        not deleted while the app is installed. If you subscribe again,
        everything is as it was. If you uninstall PREAURA, we delete your
        store’s data 48 hours later, as described in the privacy policy.
      </p>

      <h2>6. Your responsibilities as the seller</h2>
      <ul>
        <li>
          You are the seller to your customers. You decide the dates, quantities
          and pre-order terms, and you are responsible for them towards your
          customers, including information duties, rights of withdrawal and
          delivery under the consumer law that applies to you.
        </li>
        <li>
          PREAURA never pays out money. Cancellations and released units change
          the order in Shopify without a refund. If your customer has paid, you
          make any refund yourself in Shopify.
        </li>
        <li>
          The waitlist may only be used to tell a customer that the item they
          signed up for can be bought. Using sign-ups for newsletters or other
          marketing requires separate consent, which PREAURA does not collect.
        </li>
        <li>
          You keep your Shopify store, your theme and your access credentials
          secure, and you use PREAURA in accordance with Shopify’s terms and the
          law.
        </li>
      </ul>

      <h2>7. Personal data</h2>
      <p>
        When PREAURA processes personal data about your customers, we do so as
        your data processor. Our <a href="/dpa">data processing agreement</a>{" "}
        forms part of these terms, and our <a href="/privacy">privacy policy</a>{" "}
        describes what PREAURA stores, for how long, and why.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        We work to keep PREAURA available and correct, but we do not guarantee
        uninterrupted or error-free operation. PREAURA depends on Shopify and,
        where you choose, on services such as Shopify Flow or Klaviyo, which we
        do not control. We may improve and change the app. We will not remove a
        core feature you pay for without at least 30 days’ notice.
      </p>

      <h2>9. Liability</h2>
      <ul>
        <li>
          We are not liable for indirect loss, such as lost sales, lost profit,
          lost data or claims from your customers.
        </li>
        <li>
          Our total liability is limited to the fees you have paid for PREAURA
          in the 12 months before the event that caused the claim.
        </li>
        <li>
          These limits do not apply where liability cannot be limited by law,
          for example in case of gross negligence or intent.
        </li>
      </ul>

      <h2>10. Rights</h2>
      <p>
        PREAURA, its code and its name belong to us. You get the right to use
        PREAURA in your store while you have it installed. Your store’s data
        belongs to you.
      </p>

      <h2>11. Suspension and termination</h2>
      <p>
        You can stop using PREAURA at any time by uninstalling it. We may
        suspend or end your access if you misuse the app, break these terms or
        do not pay, after notice where reasonable.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these terms. Material changes are announced at least 30
        days before they take effect. If you continue to use PREAURA after that,
        the new terms apply.
      </p>

      <h2>13. Law, disputes and language</h2>
      <p>
        These terms are governed by Danish law. Disputes are settled by the
        Danish courts, with the City Court of Copenhagen (Københavns Byret) as
        the first instance. The terms are available in English and Danish. If
        the two versions differ, the English version applies.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these terms: <Mail />.
      </p>
    </section>
  );
}

function Danish() {
  return (
    <section id="da" lang="da">
      <h1>Handelsbetingelser for PREAURA</h1>
      <p style={styles.muted}>Senest opdateret: {UPDATED.da}</p>

      <h2>1. Hvem vi er</h2>
      <p>
        PREAURA leveres af {PROVIDER.name}, CVR {PROVIDER.cvr},{" "}
        {PROVIDER.addressDa} («vi», «os»). Kontakt: <Mail />.
      </p>

      <h2>2. Hvem betingelserne gælder for</h2>
      <p>
        Betingelserne gælder for den virksomhed, der installerer PREAURA i sin
        Shopify-butik («du», «webshoppen»). PREAURA er et værktøj til
        virksomheder og tilbydes ikke til forbrugere. Når du installerer eller
        bruger PREAURA, accepterer du betingelserne på virksomhedens vegne.
      </p>

      <h2>3. Hvad PREAURA gør</h2>
      <p>
        Med PREAURA kan du sælge varer på forudbestilling i din Shopify-butik.
        Du opretter leverancer med en forventet dato og et antal. PREAURA viser
        datoen for dine kunder, reserverer enheder pr. leverance, holder ordrer
        og lager i takt og kan lade kunder annullere, skrive sig på en
        venteliste og se i kurven, at der intet betales i dag. Funktionerne er
        beskrevet på vores side i Shopify App Store.
      </p>

      <h2>4. Abonnement, prøveperiode og betaling</h2>
      <ul>
        <li>
          PREAURA har ét abonnement. Pris og længden af den gratis prøveperiode
          står på siden i Shopify App Store og på Shopifys side for valg af
          abonnement, når du installerer.
        </li>
        <li>
          Betalingen håndteres af Shopify og står på din Shopify-faktura.
          Shopifys betingelser gælder for selve betalingen.
        </li>
        <li>
          Du kan opsige når som helst i Shopify eller ved at afinstallere appen.
          Beløb, der allerede er opkrævet, refunderes ikke, medmindre Shopifys
          regler for betaling eller ufravigelig lovgivning siger andet.
        </li>
        <li>
          Vi kan ændre prisen med mindst 30 dages varsel. Ændringen gælder fra
          den første betalingsperiode efter varslet.
        </li>
      </ul>

      <h2>5. Når abonnementet stopper</h2>
      <p>
        Udløber prøveperioden uden abonnement, eller opsiger du, holder PREAURAs
        funktioner op med at virke. Dine leverancer, reservationer og ordredata
        slettes ikke, så længe appen er installeret. Starter du abonnementet
        igen, er alt, som det var. Afinstallerer du PREAURA, sletter vi
        butikkens data 48 timer senere, som beskrevet i privatlivspolitikken.
      </p>

      <h2>6. Dit ansvar som sælger</h2>
      <ul>
        <li>
          Du er sælgeren over for dine kunder. Du bestemmer datoer, antal og
          vilkår for forudbestilling og står selv inde for dem over for
          kunderne, herunder oplysningspligt, fortrydelsesret og levering efter
          den forbrugerlovgivning, der gælder for dig.
        </li>
        <li>
          PREAURA udbetaler aldrig penge. Annulleringer og frigivne enheder
          retter ordren i Shopify uden refundering. Har kunden betalt,
          refunderer du selv i Shopify.
        </li>
        <li>
          Ventelisten må kun bruges til at fortælle kunden, at den vare, kunden
          har skrevet sig op til, kan købes. Skal tilmeldinger bruges til
          nyhedsbrev eller anden markedsføring, kræver det et særskilt samtykke,
          som PREAURA ikke indhenter.
        </li>
        <li>
          Du holder din Shopify-butik, dit tema og dine adgangsoplysninger sikre
          og bruger PREAURA i overensstemmelse med Shopifys betingelser og
          lovgivningen.
        </li>
      </ul>

      <h2>7. Persondata</h2>
      <p>
        Når PREAURA behandler persondata om dine kunder, gør vi det som din
        databehandler. Vores <a href="/dpa">databehandleraftale</a> er en del af
        disse betingelser, og vores <a href="/privacy">privatlivspolitik</a>{" "}
        beskriver, hvad PREAURA gemmer, hvor længe og hvorfor.
      </p>

      <h2>8. Drift og ændringer</h2>
      <p>
        Vi arbejder for, at PREAURA er tilgængelig og korrekt, men vi garanterer
        ikke uafbrudt eller fejlfri drift. PREAURA afhænger af Shopify og, hvis
        du vælger det, af tjenester som Shopify Flow eller Klaviyo, som vi ikke
        styrer. Vi kan forbedre og ændre appen. Vi fjerner ikke en central
        funktion, du betaler for, uden mindst 30 dages varsel.
      </p>

      <h2>9. Ansvar</h2>
      <ul>
        <li>
          Vi er ikke ansvarlige for indirekte tab, fx tabt salg, tabt
          fortjeneste, tabte data eller krav fra dine kunder.
        </li>
        <li>
          Vores samlede ansvar er begrænset til det beløb, du har betalt for
          PREAURA i de 12 måneder før den begivenhed, der gav anledning til
          kravet.
        </li>
        <li>
          Begrænsningerne gælder ikke, hvor ansvaret ikke kan begrænses efter
          loven, fx ved grov uagtsomhed eller forsæt.
        </li>
      </ul>

      <h2>10. Rettigheder</h2>
      <p>
        PREAURA, koden og navnet tilhører os. Du får ret til at bruge PREAURA i
        din butik, så længe den er installeret. Butikkens data tilhører dig.
      </p>

      <h2>11. Suspension og ophør</h2>
      <p>
        Du kan stoppe med at bruge PREAURA når som helst ved at afinstallere
        den. Vi kan suspendere eller lukke din adgang, hvis du misbruger appen,
        overtræder betingelserne eller ikke betaler, efter varsel hvor det er
        rimeligt.
      </p>

      <h2>12. Ændringer af betingelserne</h2>
      <p>
        Vi kan opdatere betingelserne. Væsentlige ændringer varsles mindst 30
        dage, før de træder i kraft. Bruger du PREAURA derefter, gælder de nye
        betingelser.
      </p>

      <h2>13. Lovvalg, tvister og sprog</h2>
      <p>
        Betingelserne er underlagt dansk ret. Tvister afgøres ved de danske
        domstole med Københavns Byret som første instans. Betingelserne findes
        på engelsk og dansk. Er der forskel på de to versioner, gælder den
        engelske.
      </p>

      <h2>14. Kontakt</h2>
      <p>
        Spørgsmål til betingelserne: <Mail />.
      </p>
    </section>
  );
}
