import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import type { ReactNode } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DATE_MODES, forShop, type DateMode } from "../models/preorder.server";
import { shopifySync } from "../sync/index.server";
import { PLAN_LANGUAGES, isStandardDateText } from "../sync/plans";
import { translate, useT, type Locale } from "../i18n";
import { localeFor } from "../i18n/locale.server";
import { outboxFor } from "../models/outbox.server";
import { waitlistFor } from "../models/waitlist.server";
import {
  CART_EMBED_HANDLE,
  cartEmbedUrl,
  themeBlockUrl,
} from "../onboarding/setup";
import { useBlockInfo } from "../components/ThemeBlock";
import type { BlockStatus } from "../onboarding/setup";

// Indstillinger, samlet ét sted: til venstre hvad det handler om, til
// højre et kort med status og en knap til at ændre det.
//
// Her redigeres sprog, datoens visning og teksten ved planen i kurv og
// checkout. Resten (annullering, venteliste, integrationer, temaet) vises
// som overblik med et link til siden, hvor det ændres — så hver indstilling
// stadig kun har ét sted, den gemmes.
//
// Tekster på produktsiden og i kurven (knap, forklaring …) står på blokken
// i temaeditoren, ikke her.

const MAX_LENGTH = 200;

/** Standardteksten vises på butiksejerens sprog; en egen tekst som den er. */
function shown(value: string, kind: "shipping" | "delivery", locale: Locale) {
  return isStandardDateText(value) ? PLAN_LANGUAGES[locale][kind] : value;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = await localeFor(request, session.shop);
  const [settings, integrations, waitlistWaiting] = await Promise.all([
    forShop(session.shop).settings.get(),
    outboxFor(session.shop).integrations.status(),
    waitlistFor(session.shop).countWaiting(),
  ]);
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return {
    form: {
      dateMode: settings.dateMode as DateMode,
      shippingDateText: shown(settings.shippingDateText, "shipping", locale),
      deliveryDateText: shown(settings.deliveryDateText, "delivery", locale),
    },
    language: (settings.adminLocaleChosen as Locale | null) ?? "auto",
    overview: {
      cancelWindow: settings.cancelWindow,
      cancelDays: settings.cancelDays,
      cancelApproval: settings.cancelApproval,
      cancelAutoDays: settings.cancelAutoDays,
      paymentGraceDays: settings.paymentGraceDays,
      waitlistBatchSize: settings.waitlistBatchSize,
      waitlistBatchMinutes: settings.waitlistBatchMinutes,
      waitlistWaiting,
      integrations,
      themeBlockUrl: themeBlockUrl(apiKey),
      cartEmbedUrl: cartEmbedUrl(apiKey),
    },
  };
};

const TEXT_FIELDS = ["shippingDateText", "deliveryDateText"] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await localeFor(request, session.shop);
  const form = await request.formData();

  const dateMode = String(form.get("dateMode")) as DateMode;
  const errors: Partial<Record<TextField | "dateMode", string>> = {};
  if (!DATE_MODES.includes(dateMode)) {
    errors.dateMode = translate(locale, "settings.error.mode");
  }

  const texts = {} as Record<TextField, string>;
  for (const field of TEXT_FIELDS) {
    const value = String(form.get(field) ?? "").trim();
    if (!value) errors[field] = translate(locale, "settings.error.empty");
    else if (value.length > MAX_LENGTH) {
      errors[field] = translate(locale, "settings.error.tooLong", {
        max: MAX_LENGTH,
      });
    }
    texts[field] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const data = forShop(session.shop);
  const before = await data.settings.get();
  // Knaptekst og besked bruges ikke længere (de står på blokken i temaet);
  // de gemte værdier bevares uændret.
  await data.settings.update({
    dateMode,
    ...texts,
    buttonLabel: before.buttonLabel,
    preorderNote: before.preorderNote,
  });

  // Visningen (afsendelse/levering) står i variantens metafelt, som
  // produktsiden læser. Er den ændret, synkroniseres varianterne.
  if (before.dateMode !== dateMode) {
    const sync = shopifySync(admin.graphql, session.shop);
    const products = await data.variantPlans.listProducts();
    for (const { productId } of products) {
      for (const plan of await data.variantPlans.listForProduct(productId)) {
        if (plan.preorderEnabled) await sync.sync(plan.variantId);
      }
    }
  }
  return { ok: true as const };
};

export default function Settings() {
  const { form: saved, language, overview } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const languageFetcher = useFetcher();
  const shopify = useAppBridge();
  const { t } = useT();
  const [values, setValues] = useState(saved);
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};
  const busy = fetcher.state !== "idle";
  const block = useBlockInfo().status;
  const cart = useBlockInfo(CART_EMBED_HANDLE).status;
  const chosenLanguage =
    (languageFetcher.formData?.get("locale") as string | undefined) ??
    language;

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(t("settings.saved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, shopify]);

  // Værdien læses med det samme: når React kører opdateringen, er
  // event.currentTarget allerede nulstillet.
  const set = (field: keyof typeof values) => (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const onOff = (on: boolean) =>
    on ? t("settings.status.on") : t("settings.status.off");
  const integrations = overview.integrations;

  return (
    <s-page heading={t("settings.heading")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => fetcher.submit(values, { method: "POST" })}
        {...(busy ? { loading: true } : {})}
      >
        {t("product.save")}
      </s-button>

      <SettingsRow
        heading={t("settings.language.heading")}
        text={t("settings.language.text")}
      >
        <s-choice-list
          label={t("settings.language.label")}
          labelAccessibilityVisibility="exclusive"
          name="language"
          values={[chosenLanguage]}
          onChange={(event) =>
            languageFetcher.submit(
              { locale: event.currentTarget.values[0] ?? "auto" },
              { method: "POST", action: "/app/language" },
            )
          }
        >
          <s-choice value="auto">{t("language.auto")}</s-choice>
          <s-choice value="da">Dansk</s-choice>
          <s-choice value="en">English</s-choice>
        </s-choice-list>
      </SettingsRow>

      <SettingsRow
        heading={t("settings.date.heading")}
        text={t("settings.date.text")}
      >
        <s-stack gap="base">
          <s-choice-list
            label={t("settings.date.label")}
            name="dateMode"
            values={[values.dateMode]}
            error={errors.dateMode}
            onChange={(event) => {
              // Læses før opdateringen — se kommentaren ved set().
              const dateMode = (event.currentTarget.values[0] ??
                "SHIPPING") as DateMode;
              setValues((current) => ({ ...current, dateMode }));
            }}
          >
            <s-choice value="SHIPPING">
              {t("settings.date.shipping")}
            </s-choice>
            <s-choice value="DELIVERY">
              {t("settings.date.delivery")}
            </s-choice>
          </s-choice-list>
          <s-divider />
          <s-paragraph>{t("settings.texts.intro")}</s-paragraph>
          <s-text-field
            label={t("settings.texts.shipping")}
            details={t("settings.texts.dateHint")}
            value={values.shippingDateText}
            maxLength={MAX_LENGTH}
            error={errors.shippingDateText}
            onChange={set("shippingDateText")}
          />
          <s-text-field
            label={t("settings.texts.delivery")}
            details={t("settings.texts.dateHint")}
            value={values.deliveryDateText}
            maxLength={MAX_LENGTH}
            error={errors.deliveryDateText}
            onChange={set("deliveryDateText")}
          />
        </s-stack>
      </SettingsRow>

      <SettingsRow
        heading={t("settings.theme.heading")}
        text={t("settings.theme.text")}
      >
        <SummaryCard
          items={[
            {
              icon: "product",
              label: t("settings.theme.block"),
              badge: <BlockBadge status={block} />,
            },
            {
              icon: "cart",
              label: t("settings.theme.cart"),
              badge: <BlockBadge status={cart} />,
            },
          ]}
          actions={
            <>
              <s-button href={overview.themeBlockUrl} target="_blank">
                {t("settings.theme.editBlock")}
              </s-button>
              <s-button href={overview.cartEmbedUrl} target="_blank">
                {t("settings.theme.editCart")}
              </s-button>
            </>
          }
        />
      </SettingsRow>

      <SettingsRow
        heading={t("settings.release.heading")}
        text={t("settings.release.text")}
      >
        <SummaryCard
          items={[
            {
              icon: "calendar-time",
              label: t("settings.release.window"),
              value:
                overview.cancelWindow === "DAYS"
                  ? t("settings.release.windowDays", {
                      count: overview.cancelDays,
                    })
                  : t("settings.release.windowFulfilled"),
            },
            {
              icon: "check-circle",
              label: t("settings.release.approval"),
              value:
                overview.cancelApproval === "AUTO"
                  ? t("settings.release.approvalAuto", {
                      count: overview.cancelAutoDays,
                    })
                  : t("settings.release.approvalManual"),
            },
            {
              icon: "credit-card-cancel",
              label: t("settings.release.grace"),
              value: t("settings.release.graceDays", {
                count: overview.paymentGraceDays,
              }),
            },
          ]}
          actions={
            <s-button href="/app/releases">{t("settings.customize")}</s-button>
          }
        />
      </SettingsRow>

      <SettingsRow
        heading={t("settings.waitlist.heading")}
        text={t("settings.waitlist.text")}
      >
        <SummaryCard
          items={[
            {
              icon: "person-list",
              label: t("settings.waitlist.waiting"),
              value: String(overview.waitlistWaiting),
            },
            {
              icon: "email",
              label: t("settings.waitlist.pace"),
              value: t("settings.waitlist.paceValue", {
                size: overview.waitlistBatchSize,
                minutes: overview.waitlistBatchMinutes,
              }),
            },
          ]}
          actions={
            <s-button href="/app/waitlist">{t("settings.see")}</s-button>
          }
        />
      </SettingsRow>

      <SettingsRow
        heading={t("settings.integrations.heading")}
        text={t("settings.integrations.text")}
        last
      >
        <SummaryCard
          items={[
            {
              icon: "automation",
              label: "Shopify Flow",
              badge: <OnOffBadge on={integrations.flow} label={onOff} />,
            },
            {
              icon: "connect",
              label: "Webhook",
              badge: <OnOffBadge on={integrations.webhook} label={onOff} />,
            },
            {
              icon: "email-newsletter",
              label: "Klaviyo",
              badge: <OnOffBadge on={integrations.klaviyo} label={onOff} />,
            },
          ]}
          actions={
            <s-button href="/app/events">{t("settings.customize")}</s-button>
          }
        />
      </SettingsRow>
    </s-page>
  );
}

/**
 * Én række: overskrift og forklaring til venstre, kortet til højre. På en
 * smal skærm står de under hinanden.
 */
function SettingsRow({
  heading,
  text,
  children,
  last = false,
}: {
  heading: string;
  text: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <s-box paddingBlockEnd={last ? "none" : "large"}>
      <s-grid
        gridTemplateColumns="@container (inline-size > 640px) 1fr 2fr, 1fr"
        gap="base"
      >
        <s-stack gap="small-200">
          <s-heading>{heading}</s-heading>
          <s-text color="subdued">{text}</s-text>
        </s-stack>
        <s-section>{children}</s-section>
      </s-grid>
    </s-box>
  );
}

type IconType = HTMLElementTagNameMap["s-icon"]["type"];

/** Overblik: en linje pr. indstilling med ikon, navn og værdi. */
function SummaryCard({
  items,
  actions,
}: {
  items: {
    icon: IconType;
    label: string;
    value?: string;
    badge?: ReactNode;
  }[];
  actions: ReactNode;
}) {
  return (
    <s-stack gap="base">
      <s-stack gap="small-200">
        {items.map((item) => (
          <s-box
            key={item.label}
            padding="small-200 base"
            border="base"
            borderRadius="large-100"
          >
            <s-stack
              direction="inline"
              gap="small-200"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-icon type={item.icon} tone="neutral" size="small" />
                <s-text>{item.label}</s-text>
              </s-stack>
              {item.badge ?? <s-text type="strong">{item.value}</s-text>}
            </s-stack>
          </s-box>
        ))}
      </s-stack>
      <s-stack direction="inline" gap="small-200">
        {actions}
      </s-stack>
    </s-stack>
  );
}

function BlockBadge({ status }: { status: BlockStatus }) {
  const { t } = useT();
  if (status === "active") {
    return <s-badge tone="success">{t("settings.status.active")}</s-badge>;
  }
  if (status === "inactive") {
    return <s-badge tone="warning">{t("settings.status.inactive")}</s-badge>;
  }
  return <s-badge>{t("settings.status.unknown")}</s-badge>;
}

function OnOffBadge({
  on,
  label,
}: {
  on: boolean;
  label: (on: boolean) => string;
}) {
  return <s-badge tone={on ? "success" : undefined}>{label(on)}</s-badge>;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
