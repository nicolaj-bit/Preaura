import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { outboxFor } from "../models/outbox.server";
import { scheduleQueue } from "../orders/scheduler.server";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";
import {
  validateKlaviyoKey,
  validateWebhookUrl,
} from "../lib/integrationInput";
import { numericId } from "../lib/ids";
import { EVENT_LABELS, isEventType } from "../events/build";
import {
  CHANNEL_LABELS,
  SIGNATURE_HEADER,
  type Channel,
} from "../events/labels";

// Hændelser: modtagere (Flow, webhook, Klaviyo), fejlede leveringer og
// logbogen. Nøgler og adresser vises aldrig — kun de sidste fire tegn.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const outbox = outboxFor(session.shop);
  const [settings, failed, log, waiting, timeZone] = await Promise.all([
    outbox.integrations.view(),
    outbox.deliveries.failed(),
    outbox.deliveries.log(50),
    outbox.events.unbuilt(50),
    fetchShopTimeZone(admin.graphql),
  ]);
  const format = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const label = (type: string) =>
    isEventType(type) ? EVENT_LABELS[type] : type;
  const row = (d: (typeof log)[number]) => ({
    id: d.id,
    type: label(d.event.type),
    channel: CHANNEL_LABELS[d.channel as Channel] ?? d.channel,
    ...reference(d.event),
    at: format.format(d.deliveredAt ?? d.updatedAt),
    status: d.status,
    attempts: d.attempts,
    error: d.lastError,
  });
  return {
    settings: {
      ...settings,
      responsibilityAcceptedAt: settings.responsibilityAcceptedAt
        ? format.format(settings.responsibilityAcceptedAt)
        : null,
    },
    failed: failed.map((d) => ({
      ...row(d),
      canRetry: d.event.payloadEnc != null,
    })),
    log: log.map(row),
    // Hændelser, der endnu ikke er bygget og sendt — med årsagen, hvis det
    // er gået galt. Uden dem ville en hændelse, der sidder fast, være usynlig.
    waiting: waiting.map((e) => ({
      id: e.id,
      type: label(e.type),
      ...reference(e),
      at: format.format(e.createdAt),
      error: e.lastError,
    })),
    encryptionMissing: !process.env.PREAURA_ENCRYPTION_KEY,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const integrations = outboxFor(session.shop).integrations;
  const deliveries = outboxFor(session.shop).deliveries;
  const on = form.get("enabled") === "true";

  switch (form.get("intent")) {
    case "responsibility":
      await integrations.acceptResponsibility(on);
      return { ok: true, message: on ? "Bekræftet" : "Bekræftelse fjernet" };
    case "flow":
      await integrations.setFlow(on);
      return { ok: true, message: on ? "Flow slået til" : "Flow slået fra" };
    case "webhookUrl": {
      const result = validateWebhookUrl(String(form.get("url") ?? ""));
      if (!result.ok) return { ok: false, message: result.error };
      await integrations.setWebhookUrl(result.url);
      return { ok: true, message: "Adressen er gemt" };
    }
    case "webhookRemove":
      await integrations.setWebhookUrl(null);
      return { ok: true, message: "Adressen er fjernet" };
    case "webhookEnabled":
      await integrations.setWebhookEnabled(on);
      return {
        ok: true,
        message: on ? "Webhook slået til" : "Webhook slået fra",
      };
    case "webhookSecret":
      await integrations.regenerateWebhookSecret();
      return { ok: true, message: "Ny signaturnøgle lavet" };
    case "klaviyoKey": {
      const result = validateKlaviyoKey(String(form.get("key") ?? ""));
      if (!result.ok) return { ok: false, message: result.error };
      await integrations.setKlaviyoKey(result.key);
      return { ok: true, message: "Nøglen er gemt" };
    }
    case "klaviyoRemove":
      await integrations.setKlaviyoKey(null);
      return { ok: true, message: "Nøglen er fjernet" };
    case "klaviyoEnabled":
      await integrations.setKlaviyoEnabled(on);
      return {
        ok: true,
        message: on ? "Klaviyo slået til" : "Klaviyo slået fra",
      };
    case "retry": {
      const id = form.get("deliveryId");
      const count = await deliveries.retry(id ? String(id) : undefined);
      scheduleQueue(session.shop, 0);
      return { ok: true, message: `${count} levering(er) sendes igen` };
    }
    default:
      return { ok: false, message: "Ukendt handling." };
  }
};

const STATUS: Record<
  string,
  { tone: "success" | "critical" | "info"; text: string }
> = {
  DONE: { tone: "success", text: "Sendt" },
  FAILED: { tone: "critical", text: "Fejlet" },
  PENDING: { tone: "info", text: "Venter" },
};

/** Ordren, hændelsen handler om — eller produktet for ventelisten. */
function reference(event: {
  orderId: string | null;
  orderName: string;
  productId?: string | null;
}) {
  if (event.orderId) {
    return {
      reference: event.orderName || numericId(event.orderId),
      href: `shopify://admin/orders/${numericId(event.orderId)}`,
    };
  }
  return {
    reference: "Venteliste",
    href: event.productId
      ? `shopify://admin/products/${numericId(event.productId)}`
      : "/app/waitlist",
  };
}

export default function EventsPage() {
  const { settings, failed, log, waiting, encryptionMissing } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const accepted = settings.responsibilityAcceptedAt != null;

  // Felterne tømmes, når en nøgle eller adresse er gemt — så den ikke står
  // synlig på skærmen bagefter. Ved fejl bliver indtastningen stående.
  const [handled, setHandled] = useState(fetcher.data);
  if (fetcher.data !== handled) {
    setHandled(fetcher.data);
    if (fetcher.data?.ok) {
      setUrl("");
      setKey("");
    }
  }

  useEffect(() => {
    if (fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  const submit = (values: Record<string, string>) =>
    fetcher.submit(values, { method: "POST" });

  return (
    <s-page heading="Hændelser">
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            PREAURA sender fire hændelser, når der sker noget med en
            forudbestilling: <strong>oprettet</strong>,{" "}
            <strong>forsinket</strong>, <strong>klar til afsendelse</strong> og{" "}
            <strong>annulleret</strong>. Hver hændelse indeholder butik, kundens
            navn og e-mail, ordrenummer, produkt og variant, antal, leverancens
            dato, den tidligere dato, hvis den er ændret, og et entydigt id.
            Indholdet er det samme hos alle modtagere — det er jer, der bygger
            mailen.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Ansvar for kundeoplysninger">
        <s-stack gap="base">
          <s-banner tone="warning">
            <s-paragraph>
              Webhook og Klaviyo sender kundens navn og e-mail videre til en
              tredjepart. Butikken er selv ansvarlig for at have et lovligt
              grundlag for det (fx samtykke eller kundens ordre) og for sin egen
              aftale med modtageren. PREAURA sender kun på butikkens instruks og
              er databehandler — ikke afsender.
            </s-paragraph>
          </s-banner>
          <s-checkbox
            label="Butikken har grundlag for at sende kundeoplysninger til de modtagere, den slår til nedenfor"
            details={
              accepted
                ? `Bekræftet ${settings.responsibilityAcceptedAt}. Fjernes bekræftelsen, slås webhook og Klaviyo fra.`
                : "Kræves for at slå webhook og Klaviyo til. Shopify Flow kræver det ikke — det bliver i Shopify."
            }
            checked={accepted}
            onChange={() =>
              submit({ intent: "responsibility", enabled: String(!accepted) })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Shopify Flow">
        <s-stack gap="base">
          <s-switch
            label="Send hændelser til Shopify Flow"
            details="Fire triggere i Flow: «Forudbestilling oprettet», «… forsinket», «… klar til afsendelse» og «… annulleret». Byg en workflow i Flow-appen, fx en mail eller et tag, når ordren er klar."
            checked={settings.flowEnabled}
            onChange={() =>
              submit({ intent: "flow", enabled: String(!settings.flowEnabled) })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Webhook">
        <s-stack gap="base">
          <s-paragraph>
            Appen sender hændelsen som JSON med POST til jeres adresse. Brug den
            til fx Zapier, Make, Drip, Omnisend, Mailchimp eller Brevo.
          </s-paragraph>
          {settings.webhookUrlLast4 ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>Adresse gemt: ••••{settings.webhookUrlLast4}</s-text>
              <s-button
                tone="critical"
                onClick={() => submit({ intent: "webhookRemove" })}
              >
                Fjern
              </s-button>
            </s-stack>
          ) : null}
          <s-url-field
            label={settings.webhookUrlLast4 ? "Ny adresse" : "Adresse"}
            placeholder="https://hooks.zapier.com/…"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <s-button
            disabled={!url}
            onClick={() => submit({ intent: "webhookUrl", url })}
          >
            Gem adresse
          </s-button>
          <s-switch
            label="Send hændelser til webhooken"
            disabled={!accepted || !settings.webhookUrlLast4}
            checked={settings.webhookEnabled}
            onChange={() =>
              submit({
                intent: "webhookEnabled",
                enabled: String(!settings.webhookEnabled),
              })
            }
          />
          {settings.webhookSecret ? (
            <s-stack gap="small-200">
              <s-text type="strong">Signaturnøgle</s-text>
              <s-text>
                <code>{settings.webhookSecret}</code>
              </s-text>
              <s-paragraph>
                Hvert kald har headeren <code>{SIGNATURE_HEADER}</code>:
                HMAC-SHA256 af den rå tekst i kaldet med denne nøgle,
                base64-kodet. Beregn den selv, og sammenlign — så ved I, at
                kaldet kommer fra PREAURA. Headeren{" "}
                <code>X-Preaura-Event-Id</code> er hændelsens id; brug den til
                at se bort fra gentagelser.
              </s-paragraph>
              <s-button onClick={() => submit({ intent: "webhookSecret" })}>
                Lav ny signaturnøgle
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Klaviyo">
        <s-stack gap="base">
          <s-paragraph>
            Hændelserne sendes til Klaviyo som metrics, fx «PREAURA:
            Forudbestilling klar til afsendelse», på kundens profil. Klaviyo
            opretter selv metricen første gang, og den kan bruges som udløser i
            et flow. Brug en privat API-nøgle med adgang til Events (Settings →
            API keys i Klaviyo).
          </s-paragraph>
          {settings.klaviyoKeyLast4 ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>Nøgle gemt: ••••{settings.klaviyoKeyLast4}</s-text>
              <s-button
                tone="critical"
                onClick={() => submit({ intent: "klaviyoRemove" })}
              >
                Fjern
              </s-button>
            </s-stack>
          ) : null}
          <s-password-field
            label={
              settings.klaviyoKeyLast4
                ? "Ny privat API-nøgle"
                : "Privat API-nøgle"
            }
            placeholder="pk_…"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
          />
          <s-button
            disabled={!key}
            onClick={() => submit({ intent: "klaviyoKey", key })}
          >
            Gem nøgle
          </s-button>
          <s-switch
            label="Send hændelser til Klaviyo"
            disabled={!accepted || !settings.klaviyoKeyLast4}
            checked={settings.klaviyoEnabled}
            onChange={() =>
              submit({
                intent: "klaviyoEnabled",
                enabled: String(!settings.klaviyoEnabled),
              })
            }
          />
        </s-stack>
      </s-section>

      {encryptionMissing && (
        <s-banner tone="critical" heading="Krypteringsnøglen mangler">
          <s-paragraph>
            Serveren mangler miljøvariablen PREAURA_ENCRYPTION_KEY. Uden den kan
            hændelser ikke bygges, og nøgler og adresser kan ikke gemmes. På
            Render: preaura → Environment, eller Manual sync på blueprintet.
          </s-paragraph>
        </s-banner>
      )}

      {waiting.length > 0 && (
        <s-section heading="Venter på at blive sendt">
          <s-stack gap="base">
            <s-paragraph>
              Disse hændelser er ikke sendt endnu. Normalt sker det inden for et
              minut. Står der en fejl, prøver appen igen hvert minut.
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Hændelse</s-table-header>
                <s-table-header>Ordre / produkt</s-table-header>
                <s-table-header>Oprettet</s-table-header>
                <s-table-header listSlot="secondary">Fejl</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {waiting.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>{row.type}</s-table-cell>
                    <s-table-cell>
                      <s-link href={row.href}>{row.reference}</s-link>
                    </s-table-cell>
                    <s-table-cell>{row.at}</s-table-cell>
                    <s-table-cell>
                      {row.error ? (
                        <s-text tone="critical">{row.error}</s-text>
                      ) : (
                        "–"
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Fejlede leveringer">
        {failed.length === 0 ? (
          <s-paragraph>Ingen fejl.</s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-paragraph>
              Disse hændelser kunne ikke leveres, heller ikke efter 10 forsøg
              med voksende ventetid (op til omkring 8 timer). Ret årsagen, og
              prøv igen. Hændelsens data slettes efter 30 dage.
            </s-paragraph>
            <s-button
              variant="primary"
              onClick={() => submit({ intent: "retry" })}
            >
              Prøv alle igen
            </s-button>
            <EventTable
              rows={failed}
              action={(row) =>
                row.canRetry ? (
                  <s-button
                    onClick={() =>
                      submit({ intent: "retry", deliveryId: row.id })
                    }
                  >
                    Prøv igen
                  </s-button>
                ) : (
                  <s-text color="subdued">Data slettet</s-text>
                )
              }
            />
          </s-stack>
        )}
      </s-section>

      <s-section heading="Logbog">
        {log.length === 0 ? (
          <s-paragraph>
            Ingen hændelser endnu. De kommer, når en kunde forudbestiller.
          </s-paragraph>
        ) : (
          <EventTable rows={log} />
        )}
      </s-section>

      <s-section heading="Drip, Omnisend, Mailchimp, Brevo og andre">
        <s-stack gap="base">
          <s-paragraph>
            Brug webhooken. Med Zapier: opret en Zap med udløseren «Webhooks by
            Zapier → Catch Hook», og indsæt Zapiers adresse ovenfor. Send en
            forudbestilling igennem, så Zapier kan se felterne, og vælg derefter
            jeres mailsystem som næste trin, fx «Add/Update Subscriber» med{" "}
            <code>customer.email</code>, og en tag eller hændelse ud fra{" "}
            <code>type</code> (fx <code>preorder.ready</code>).
          </s-paragraph>
          <s-paragraph>
            Med Make: opret et scenarie med modulet «Webhooks → Custom webhook»,
            indsæt Makes adresse ovenfor, og fortsæt med jeres mailsystems
            modul. Felterne er de samme.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

type Row = {
  id: string;
  type: string;
  channel: string;
  reference: string;
  href: string;
  at: string;
  status: string;
  attempts: number;
  error: string | null;
};

function EventTable<T extends Row>({
  rows,
  action,
}: {
  rows: T[];
  action?: (row: T) => React.ReactNode;
}) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Hændelse</s-table-header>
        <s-table-header>Modtager</s-table-header>
        <s-table-header>Ordre / produkt</s-table-header>
        <s-table-header>Tidspunkt</s-table-header>
        <s-table-header listSlot="secondary">Status</s-table-header>
        <s-table-header>Besked</s-table-header>
        {action ? <s-table-header>Handling</s-table-header> : null}
      </s-table-header-row>
      <s-table-body>
        {rows.map((row) => {
          const status = STATUS[row.status] ?? {
            tone: "info" as const,
            text: row.status,
          };
          return (
            <s-table-row key={row.id}>
              <s-table-cell>{row.type}</s-table-cell>
              <s-table-cell>{row.channel}</s-table-cell>
              <s-table-cell>
                <s-link href={row.href}>{row.reference}</s-link>
              </s-table-cell>
              <s-table-cell>{row.at}</s-table-cell>
              <s-table-cell>
                <s-badge tone={status.tone}>
                  {status.text}
                  {row.attempts > 1 ? ` (${row.attempts} forsøg)` : ""}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                {row.error ? <s-text tone="critical">{row.error}</s-text> : "–"}
              </s-table-cell>
              {action ? <s-table-cell>{action(row)}</s-table-cell> : null}
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
