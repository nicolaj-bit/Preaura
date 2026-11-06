import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireSubscription } from "../billing/requireSubscription.server";
import { releaseFor } from "../models/release.server";
import { fetchShopTimeZone, numericId } from "../lib/shopifyProducts.server";
import { parseReleaseSettings, LIMITS } from "../release/settings";
import { scheduleQueue } from "../orders/scheduler.server";

// Annulleringer og afviste betalinger: kundernes anmodninger, ordrer hvor
// opkrævningen ved afsendelse er afvist, og butikkens regler for begge.
// Appen udbetaler aldrig penge — refundering sker i Shopify.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await requireSubscription(request);
  const release = releaseFor(session.shop);
  const [requests, issues, settings, timeZone] = await Promise.all([
    release.cancellations.list(),
    release.payments.list(),
    release.settings(),
    fetchShopTimeZone(admin.graphql),
  ]);
  const format = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const day = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  return {
    settings,
    requests: requests.map((r) => ({
      id: r.id,
      orderName: r.orderName || `Ordre ${numericId(r.orderId)}`,
      orderNumber: numericId(r.orderId),
      source: r.source,
      status: r.status,
      at: format.format(r.requestedAt),
      units: r.lines.reduce(
        (n, l) => n + (l.from != null ? l.from - l.quantity : 0),
        0,
      ),
      error: r.lastError,
    })),
    issues: issues.map((i) => ({
      id: i.id,
      orderName: i.orderName || `Ordre ${numericId(i.orderId)}`,
      orderNumber: numericId(i.orderId),
      status: i.status,
      failedAt: format.format(i.failedAt),
      releaseAt: format.format(i.releaseAt),
      deliveries: i.deliveries.map(
        (d) =>
          `${d.quantity} stk. i leverance ${d.position} (${day.format(new Date(`${d.date}T12:00:00Z`))})`,
      ),
      error: i.lastError,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireSubscription(request);
  const form = Object.fromEntries(await request.formData());
  const release = releaseFor(session.shop);
  const id = String(form.id ?? "");
  switch (form.intent) {
    case "approve":
      await release.cancellations.approve(id);
      scheduleQueue(session.shop, 0);
      return { ok: true as const, message: "Annulleringen er godkendt" };
    case "reject":
      await release.cancellations.reject(id);
      return { ok: true as const, message: "Anmodningen er afvist" };
    case "retry":
      await release.cancellations.retry(id);
      scheduleQueue(session.shop, 0);
      return { ok: true as const, message: "Prøves igen" };
    case "release":
      await release.payments.releaseNow(id);
      scheduleQueue(session.shop, 0);
      return { ok: true as const, message: "Enhederne frigives nu" };
    case "extend": {
      const settings = await release.settings();
      await release.payments.extend(id, settings.paymentGraceDays);
      return {
        ok: true as const,
        message: `Fristen er forlænget med ${settings.paymentGraceDays} dage`,
      };
    }
    case "settings": {
      const parsed = parseReleaseSettings(form);
      if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
      await release.updateSettings(parsed.values);
      return { ok: true as const, message: "Indstillinger gemt" };
    }
  }
  return { ok: false as const, errors: {} };
};

const REQUEST_STATUS: Record<
  string,
  { tone: "info" | "success" | "warning" | "critical"; text: string }
> = {
  PENDING: { tone: "warning", text: "Venter på dig" },
  APPROVED: { tone: "info", text: "Udføres" },
  DONE: { tone: "success", text: "Annulleret" },
  REJECTED: { tone: "info", text: "Afvist" },
  FAILED: { tone: "critical", text: "Fejlede" },
};

const ISSUE_STATUS: Record<
  string,
  { tone: "info" | "success" | "warning" | "critical"; text: string }
> = {
  OPEN: { tone: "warning", text: "Venter på betaling" },
  RELEASING: { tone: "info", text: "Frigives" },
  RELEASED: { tone: "info", text: "Frigivet" },
  PAID: { tone: "success", text: "Betalt" },
  CLOSED: { tone: "info", text: "Ordren annulleret" },
};

export default function Releases() {
  const { settings, requests, issues } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [values, setValues] = useState({
    cancelWindow: settings.cancelWindow as string,
    cancelDays: String(settings.cancelDays),
    cancelApproval: settings.cancelApproval as string,
    cancelAutoDays: String(settings.cancelAutoDays),
    paymentGraceDays: String(settings.paymentGraceDays),
  });
  const errors: Record<string, string | undefined> =
    fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  const send = (intent: string, id?: string) =>
    fetcher.submit({ intent, ...(id ? { id } : {}) }, { method: "POST" });
  const set = (field: keyof typeof values) => (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    setValues((current) => ({ ...current, [field]: value }));
  };
  const choose = (field: keyof typeof values) => (event: Event) => {
    const value = (event.currentTarget as unknown as { values: string[] })
      .values[0];
    setValues((current) => ({ ...current, [field]: value }));
  };

  const pending = requests.filter((r) => r.status === "PENDING");
  const openIssues = issues.filter(
    (i) => i.status === "OPEN" || i.status === "RELEASING",
  );
  const history = requests.filter((r) => r.status !== "PENDING");
  const closedIssues = issues.filter(
    (i) => i.status !== "OPEN" && i.status !== "RELEASING",
  );

  return (
    <s-page heading="Annulleringer">
      <s-banner tone="info">
        <s-paragraph>
          Appen udbetaler aldrig penge. Når en forudbestilling annulleres,
          rettes ordren i Shopify uden refundering, og enhederne kommer tilbage
          i leverancen. Har kunden betalt noget, refunderer du selv i Shopify.
        </s-paragraph>
      </s-banner>

      <s-section heading={`Anmodninger fra kunder (${pending.length})`}>
        {pending.length === 0 ? (
          <s-paragraph>Ingen anmodninger venter.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Ordre</s-table-header>
              <s-table-header>Modtaget</s-table-header>
              <s-table-header format="numeric">Stk.</s-table-header>
              <s-table-header>Handling</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {pending.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${r.orderNumber}`}>
                      {r.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{r.at}</s-table-cell>
                  <s-table-cell>{r.units}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        variant="primary"
                        onClick={() => send("approve", r.id)}
                      >
                        Godkend
                      </s-button>
                      <s-button onClick={() => send("reject", r.id)}>
                        Afvis
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={`Afviste betalinger (${openIssues.length})`}>
        <s-paragraph>
          Ordrer, hvor opkrævningen ved afsendelse er afvist. Enhederne frigives
          først efter fristen, så kunden kan nå at rette sit kort.
        </s-paragraph>
        {openIssues.length === 0 ? (
          <s-paragraph>Ingen afviste betalinger.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Ordre</s-table-header>
              <s-table-header>Afvist</s-table-header>
              <s-table-header>Frigives</s-table-header>
              <s-table-header>Leverance</s-table-header>
              <s-table-header>Handling</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {openIssues.map((i) => (
                <s-table-row key={i.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${i.orderNumber}`}>
                      {i.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{i.failedAt}</s-table-cell>
                  <s-table-cell>
                    {i.status === "RELEASING" ? "Nu" : i.releaseAt}
                    {i.error ? (
                      <s-text tone="critical"> {i.error}</s-text>
                    ) : null}
                  </s-table-cell>
                  <s-table-cell>{i.deliveries.join("; ") || "–"}</s-table-cell>
                  <s-table-cell>
                    {i.status === "OPEN" && (
                      <s-stack direction="inline" gap="small-200">
                        <s-button onClick={() => send("release", i.id)}>
                          Frigiv nu
                        </s-button>
                        <s-button onClick={() => send("extend", i.id)}>
                          Forlæng
                        </s-button>
                      </s-stack>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Regler">
        <s-stack gap="base">
          <s-choice-list
            label="Kunden kan annullere"
            name="cancelWindow"
            values={[values.cancelWindow]}
            error={errors.cancelWindow}
            onChange={choose("cancelWindow")}
          >
            <s-choice value="UNTIL_FULFILLED">Indtil varen er sendt</s-choice>
            <s-choice value="DAYS">Et antal dage efter bestilling</s-choice>
          </s-choice-list>
          {values.cancelWindow === "DAYS" && (
            <s-number-field
              label="Dage efter bestilling"
              details="Annullering kan ikke slås helt fra. Husk de regler for fortrydelse, der gælder dine kunder."
              value={values.cancelDays}
              min={LIMITS.cancelDays.min}
              max={LIMITS.cancelDays.max}
              error={errors.cancelDays}
              onChange={set("cancelDays")}
            />
          )}
          <s-choice-list
            label="Godkendelse"
            name="cancelApproval"
            values={[values.cancelApproval]}
            error={errors.cancelApproval}
            onChange={choose("cancelApproval")}
          >
            <s-choice value="MANUAL">Jeg godkender altid selv</s-choice>
            <s-choice value="AUTO">
              Godkend automatisk inden for et antal dage efter bestilling
            </s-choice>
          </s-choice-list>
          {values.cancelApproval === "AUTO" && (
            <s-number-field
              label="Automatisk godkendelse i dage efter bestilling"
              details="Senere annulleringer venter på din godkendelse."
              value={values.cancelAutoDays}
              min={LIMITS.cancelAutoDays.min}
              max={LIMITS.cancelAutoDays.max}
              error={errors.cancelAutoDays}
              onChange={set("cancelAutoDays")}
            />
          )}
          <s-number-field
            label="Frist ved afvist betaling (dage)"
            details="Så længe kan kunden nå at betale, før enhederne frigives."
            value={values.paymentGraceDays}
            min={LIMITS.paymentGraceDays.min}
            max={LIMITS.paymentGraceDays.max}
            error={errors.paymentGraceDays}
            onChange={set("paymentGraceDays")}
          />
          <s-stack direction="inline">
            <s-button
              variant="primary"
              onClick={() =>
                fetcher.submit(
                  { intent: "settings", ...values },
                  { method: "POST" },
                )
              }
            >
              Gem
            </s-button>
          </s-stack>
          <s-paragraph>
            Kundens link til at annullere står på ordren som metafeltet{" "}
            <s-text type="strong">preaura.cancel_url</s-text> og i hændelserne
            til Klaviyo, Shopify Flow og webhook.
          </s-paragraph>
        </s-stack>
      </s-section>

      {(history.length > 0 || closedIssues.length > 0) && (
        <s-section heading="Historik">
          <s-unordered-list>
            {history.map((r) => (
              <s-list-item key={r.id}>
                {r.orderName}: {r.units} stk., {r.at} —{" "}
                <s-badge tone={REQUEST_STATUS[r.status]?.tone ?? "info"}>
                  {REQUEST_STATUS[r.status]?.text ?? r.status}
                </s-badge>
                {r.error && r.status !== "DONE" && (
                  <>
                    {" "}
                    <s-text tone="critical">
                      {r.status === "APPROVED" ? "Forsøger igen: " : ""}
                      {r.error}
                    </s-text>
                  </>
                )}
                {r.status === "FAILED" && (
                  <>
                    {" "}
                    <s-button onClick={() => send("retry", r.id)}>
                      Prøv igen
                    </s-button>
                  </>
                )}
              </s-list-item>
            ))}
            {closedIssues.map((i) => (
              <s-list-item key={i.id}>
                {i.orderName}: betaling afvist {i.failedAt} —{" "}
                <s-badge tone={ISSUE_STATUS[i.status]?.tone ?? "info"}>
                  {ISSUE_STATUS[i.status]?.text ?? i.status}
                </s-badge>
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
