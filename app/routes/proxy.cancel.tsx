import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { accessFor } from "../billing/access.server";
import { shopifySync } from "../sync/index.server";
import { releaseFor } from "../models/release.server";
import { readCancelLink } from "../release/link.server";
import {
  cancelState,
  escape,
  targetsFromSelection,
  type CancelLine,
} from "../release/cancel";
import { scheduleQueue } from "../orders/scheduler.server";
import { formatDate, translate, type Locale, type MessageKey } from "../i18n";

// Kundens annulleringsside: /apps/preaura/cancel?o=…&x=…&s=… i butikken.
//
// - Intet login: linket er signeret, udløber og gælder kun den ene ordre.
// - Siden viser kun det, der skal til for at bekræfte, at det er den rigtige
//   ordre: ordrenummer, de forudbestilte varer, antal og lovet dato. Ingen
//   navne, adresser, priser eller betaling.
// - Siden vises i butikkens tema (Liquid via app-proxyen), på kundens sprog
//   i butikken: dansk eller engelsk, valgt i Liquid ud fra request.locale.
// - Annulleringen bliver en anmodning. Godkendt (automatisk eller af
//   butikken) frigives enhederne gennem den samme frigivelse som alt andet.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return render(context, params, null);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const form = Object.fromEntries(await request.formData());
  const params = {
    ...Object.fromEntries(new URL(request.url).searchParams),
    o: form.o,
    x: form.x,
    s: form.s,
  };
  return render(context, params, form);
};

type Context = Awaited<ReturnType<typeof authenticate.public.appProxy>>;

async function render(
  { session, admin, liquid }: Context,
  params: Record<string, unknown>,
  form: Record<string, unknown> | null,
) {
  // Altid 200: ellers kan Shopify vise sin egen fejlside i stedet for
  // forklaringen til kunden.
  const page = (body: (locale: Locale) => string) =>
    liquid(
      bilingual((locale) => layout(locale, body(locale))),
      {
        layout: true,
        headers: { "Cache-Control": "no-store" },
      },
    );
  const message = (key: MessageKey) =>
    page((locale) => `<p>${escape(translate(locale, key))}</p>`);

  if (!session || !admin) return message("cancelPage.unavailable");
  const shop = session.shop;
  const orderId = readCancelLink(shop, {
    o: params.o,
    x: params.x,
    s: params.s,
  });
  if (!orderId) return message("cancelPage.invalid");

  let access = false;
  try {
    access = (await accessFor(admin, shop)).status === "active";
  } catch {
    access = false;
  }
  if (!access) return message("cancelPage.unavailable");

  const release = releaseFor(shop);
  const open = await release.cancellations.open(orderId);
  if (open) return message("cancelPage.alreadyRequested");

  const order = await shopifySync(admin.graphql, shop).readOrder(orderId);
  if (!order) return message("cancelPage.invalid");
  const settings = await release.settings();
  const state = cancelState(
    order,
    await release.activeByLine(orderId),
    settings,
  );
  if (!state.ok) {
    return message(
      state.reason === "cancelled"
        ? "cancelPage.alreadyCancelled"
        : state.reason === "window_closed"
          ? "cancelPage.windowClosed"
          : "cancelPage.nothing",
    );
  }

  if (form) {
    const selection: Record<string, unknown> = {};
    for (const line of state.lines) {
      selection[line.lineId] = form[`q_${numeric(line.lineId)}`];
    }
    const targets = targetsFromSelection(state.lines, selection);
    if (targets.length === 0)
      return page((locale) =>
        formHtml(
          locale,
          order.name,
          state.lines,
          params,
          "cancelPage.chooseSomething",
        ),
      );
    const created = await release.cancellations.request({
      orderId,
      orderName: order.name,
      targets,
      source: "CUSTOMER",
      approve: state.autoApprove,
    });
    if (created?.status === "APPROVED") scheduleQueue(shop, 0);
    return message(
      created?.status === "APPROVED"
        ? "cancelPage.approved"
        : "cancelPage.requested",
    );
  }
  return page((locale) =>
    formHtml(locale, order.name, state.lines, params, null),
  );
}

/**
 * Siden på begge sprog; Liquid vælger ud fra kundens sprog i butikken.
 * Dansk ved «da», ellers engelsk.
 */
function bilingual(make: (locale: Locale) => string) {
  return `{% assign preaura_lang = request.locale.iso_code | slice: 0, 2 %}{% if preaura_lang == 'da' %}${make("da")}{% else %}${make("en")}{% endif %}`;
}

function formHtml(
  locale: Locale,
  orderName: string,
  lines: CancelLine[],
  params: Record<string, unknown>,
  error: MessageKey | null,
) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const rows = lines
    .map((line) => {
      const name = [line.title, line.variantTitle].filter(Boolean).join(" – ");
      const options = Array.from(
        { length: line.cancellable + 1 },
        (_, n) =>
          `<option value="${n}"${n === line.cancellable ? " selected" : ""}>${n}</option>`,
      ).join("");
      const id = `q_${numeric(line.lineId)}`;
      return `<li>
        <p><strong>${escape(name)}</strong></p>
        ${line.promisedDate ? `<p>${escape(t("cancelPage.expected", { date: formatDate(locale, line.promisedDate) }))}</p>` : ""}
        <p><label for="${id}">${escape(t("cancelPage.quantity", { count: line.cancellable }))}</label>
        <select id="${id}" name="${id}">${options}</select></p>
      </li>`;
    })
    .join("");
  return `
    <p>${escape(t("cancelPage.order", { name: orderName }))}</p>
    ${error ? `<p role="alert"><strong>${escape(t(error))}</strong></p>` : ""}
    <form method="post">
      <input type="hidden" name="o" value="${escape(String(params.o ?? ""))}">
      <input type="hidden" name="x" value="${escape(String(params.x ?? ""))}">
      <input type="hidden" name="s" value="${escape(String(params.s ?? ""))}">
      <ul style="list-style:none;padding:0">${rows}</ul>
      <p><button type="submit" class="button">${escape(t("cancelPage.submit"))}</button></p>
    </form>`;
}

function layout(locale: Locale, body: string) {
  return `<div class="page-width" style="max-width:40rem;margin:3rem auto;padding:0 1.5rem">
    <h1>${escape(translate(locale, "cancelPage.heading"))}</h1>
    ${body}
  </div>`;
}

const numeric = (gid: string) => gid.split("/").pop() ?? gid;
