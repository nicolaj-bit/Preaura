import { useFetcher } from "react-router";
import { useT, type Locale } from "../i18n";

// Sprogvælgeren øverst på forsiden. Sproget styrer også, hvordan datoer og
// beløb skrives («1.234,50 kr.» / «DKK 1,234.50») — valutaen er altid
// butikkens, og intet omregnes.

const NAMES: Record<Locale, string> = { da: "Dansk", en: "English" };

export function LanguageMenu() {
  const fetcher = useFetcher();
  const { locale, t } = useT();
  const pending = fetcher.formData?.get("locale");
  const shown =
    pending === "da" || pending === "en" ? (pending as Locale) : locale;
  const choose = (value: Locale | "auto") =>
    fetcher.submit(
      { locale: value },
      { method: "POST", action: "/app/language" },
    );

  return (
    <s-stack direction="inline" justifyContent="end">
      <s-button
        commandFor="preaura-language-menu"
        icon="language"
        accessibilityLabel={t("language.label")}
        {...(fetcher.state !== "idle" ? { loading: true } : {})}
      >
        {NAMES[shown]}
      </s-button>
      <s-menu
        id="preaura-language-menu"
        accessibilityLabel={t("language.label")}
      >
        <s-button onClick={() => choose("da")}>{NAMES.da}</s-button>
        <s-button onClick={() => choose("en")}>{NAMES.en}</s-button>
        <s-button onClick={() => choose("auto")}>
          {t("language.auto")}
        </s-button>
      </s-menu>
    </s-stack>
  );
}
