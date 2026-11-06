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

// Kundens annulleringsside: /apps/preaura/cancel?o=…&x=…&s=… i butikken.
//
// - Intet login: linket er signeret, udløber og gælder kun den ene ordre.
// - Siden viser kun det, der skal til for at bekræfte, at det er den rigtige
//   ordre: ordrenummer, de forudbestilte varer, antal og lovet dato. Ingen
//   navne, adresser, priser eller betaling.
// - Siden vises i butikkens tema (Liquid via app-proxyen).
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
  const page = (body: string) =>
    liquid(layout(body), {
      layout: true,
      headers: { "Cache-Control": "no-store" },
    });
  const message = (text: string) => page(`<p>${escape(text)}</p>`);

  if (!session || !admin) return message(TEXT.unavailable);
  const shop = session.shop;
  const orderId = readCancelLink(shop, {
    o: params.o,
    x: params.x,
    s: params.s,
  });
  if (!orderId) return message(TEXT.invalid);

  let access = false;
  try {
    access = (await accessFor(admin, shop)).status === "active";
  } catch {
    access = false;
  }
  if (!access) return message(TEXT.unavailable);

  const release = releaseFor(shop);
  const open = await release.cancellations.open(orderId);
  if (open) return message(TEXT.alreadyRequested);

  const order = await shopifySync(admin.graphql, shop).readOrder(orderId);
  if (!order) return message(TEXT.invalid);
  const settings = await release.settings();
  const state = cancelState(
    order,
    await release.activeByLine(orderId),
    settings,
  );
  if (!state.ok) {
    return message(
      state.reason === "cancelled"
        ? TEXT.alreadyCancelled
        : state.reason === "window_closed"
          ? TEXT.windowClosed
          : TEXT.nothing,
    );
  }

  if (form) {
    const selection: Record<string, unknown> = {};
    for (const line of state.lines) {
      selection[line.lineId] = form[`q_${numeric(line.lineId)}`];
    }
    const targets = targetsFromSelection(state.lines, selection);
    if (targets.length === 0)
      return page(
        formHtml(order.name, state.lines, params, TEXT.chooseSomething),
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
      created?.status === "APPROVED" ? TEXT.approved : TEXT.requested,
    );
  }
  return page(formHtml(order.name, state.lines, params, null));
}

const TEXT = {
  heading: "Annullér forudbestilling",
  invalid:
    "Linket er ugyldigt eller udløbet. Kontakt butikken, hvis du vil annullere din forudbestilling.",
  unavailable:
    "Annullering via link er ikke tilgængelig lige nu. Kontakt butikken, hvis du vil annullere din forudbestilling.",
  alreadyRequested:
    "Vi har allerede modtaget din anmodning om at annullere. Du hører fra butikken.",
  alreadyCancelled: "Forudbestillingen er allerede annulleret.",
  windowClosed:
    "Fristen for at annullere via linket er udløbet, eller varen er sendt. Kontakt butikken.",
  nothing: "Der er ingen forudbestilte varer at annullere på ordren.",
  chooseSomething: "Vælg hvor mange du vil annullere.",
  approved:
    "Din annullering er godkendt og gennemføres nu. Har du betalt noget, refunderer butikken det.",
  requested:
    "Tak. Din anmodning om at annullere er sendt til butikken, som vender tilbage.",
};

function formHtml(
  orderName: string,
  lines: CancelLine[],
  params: Record<string, unknown>,
  error: string | null,
) {
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
        ${line.promisedDate ? `<p>Forventet: ${escape(formatDate(line.promisedDate))}</p>` : ""}
        <p><label for="${id}">Antal at annullere (af ${line.cancellable})</label>
        <select id="${id}" name="${id}">${options}</select></p>
      </li>`;
    })
    .join("");
  return `
    <p>Ordre ${escape(orderName)}</p>
    ${error ? `<p role="alert"><strong>${escape(error)}</strong></p>` : ""}
    <form method="post">
      <input type="hidden" name="o" value="${escape(String(params.o ?? ""))}">
      <input type="hidden" name="x" value="${escape(String(params.x ?? ""))}">
      <input type="hidden" name="s" value="${escape(String(params.s ?? ""))}">
      <ul style="list-style:none;padding:0">${rows}</ul>
      <p><button type="submit" class="button">Annullér</button></p>
    </form>`;
}

function layout(body: string) {
  return `<div class="page-width" style="max-width:40rem;margin:3rem auto;padding:0 1.5rem">
    <h1>${escape(TEXT.heading)}</h1>
    ${body}
  </div>`;
}

const numeric = (gid: string) => gid.split("/").pop() ?? gid;

function formatDate(date: string) {
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
