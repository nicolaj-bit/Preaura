// Fejllogning og alarmer. Alt, appen skriver i Renders log om fejl, går
// herigennem.
//
// Regel: logget skal kunne finde fejlen igen, men aldrig indeholde
// persondata. Der logges butikken, handlingen, de id'er, der skal til for at
// finde sagen igen (ordre, variant, hændelse), og fejlens navn og besked.
// Aldrig hele fejlobjektet: en fejl fra Shopifys GraphQL-klient bærer hele
// svaret med sig, og svaret på en ordreforespørgsel kan indeholde kundens
// navn og e-mail. Aldrig en webhook-nyttelast. E-mailadresser i en
// fejlbesked erstattes, for en sikkerheds skyld.
//
// Er PREAURA_ALERT_URL sat, sendes der også en kort besked til et menneske
// (ntfy, Slack eller Discord). Højst én pr. slags fejl pr. butik pr. time, så
// en fejl, der gentager sig hvert minut, ikke bliver til 60 beskeder.

const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;
const MAX_MESSAGE = 500;
const ALERT_EVERY_MS = 60 * 60 * 1000;

export type LogContext = {
  shop?: string | null;
  /** Id'er, der finder sagen igen, fx { orderId, variantId, eventId }. */
  ids?: Record<string, string | number | null | undefined>;
};

/** Fjerner e-mailadresser fra en tekst. */
export function scrub(text: string) {
  return text.replace(EMAIL, "[e-mail]");
}

/** Fejlens navn og besked, uden persondata og uden fejlobjektets felter. */
export function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: scrub(error.message).slice(0, MAX_MESSAGE),
    };
  }
  return {
    name: "Unknown",
    message: scrub(String(error)).slice(0, MAX_MESSAGE),
  };
}

function line(
  level: "error" | "warn" | "info",
  action: string,
  context: LogContext,
  error?: unknown,
) {
  const entry: Record<string, unknown> = { level, action };
  if (context.shop) entry.shop = context.shop;
  if (context.ids) {
    entry.ids = Object.fromEntries(
      Object.entries(context.ids).filter(([, v]) => v != null && v !== ""),
    );
  }
  if (error !== undefined) entry.error = describeError(error);
  return JSON.stringify(entry);
}

export function logInfo(action: string, context: LogContext = {}) {
  console.info(line("info", action, context));
}

export function logWarn(
  action: string,
  context: LogContext = {},
  error?: unknown,
) {
  console.warn(line("warn", action, context, error));
}

/**
 * En fejl, et menneske skal vide besked om. Logges, og sendes som alarm,
 * hvis PREAURA_ALERT_URL er sat.
 */
export function logError(
  action: string,
  context: LogContext = {},
  error?: unknown,
) {
  console.error(line("error", action, context, error));
  void sendAlert(action, context, error);
}

// --- Alarmer -----------------------------------------------------------------

const lastAlert = new Map<string, number>();
let alertFetch: typeof fetch = (...args) => fetch(...args);

/** Kun til tests. */
export function setAlertFetch(f: typeof fetch) {
  alertFetch = f;
  lastAlert.clear();
}

/** Teksten i alarmen. Kun butik, handling, id'er og fejlbesked. */
export function alertText(
  action: string,
  context: LogContext,
  error?: unknown,
) {
  const parts = [`PREAURA: ${action}`];
  if (context.shop) parts.push(`Butik: ${context.shop}`);
  const ids = Object.entries(context.ids ?? {}).filter(
    ([, v]) => v != null && v !== "",
  );
  if (ids.length > 0) parts.push(ids.map(([k, v]) => `${k}: ${v}`).join(", "));
  if (error !== undefined) parts.push(`Fejl: ${describeError(error).message}`);
  parts.push("Se Ordrebehandling i appen og loggen på Render.");
  return parts.join("\n");
}

export async function sendAlert(
  action: string,
  context: LogContext,
  error?: unknown,
  now = Date.now(),
) {
  const url = process.env.PREAURA_ALERT_URL;
  if (!url) return false;
  const key = `${action}|${context.shop ?? ""}`;
  const last = lastAlert.get(key);
  if (last != null && now - last < ALERT_EVERY_MS) return false;
  lastAlert.set(key, now);
  const text = alertText(action, context, error);
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const init: RequestInit =
    host === "hooks.slack.com"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }
      : host.endsWith("discord.com")
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text }),
          }
        : // ntfy og andre: almindelig tekst. Titel og prioritet til ntfy.
          {
            method: "POST",
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              Title: "PREAURA: noget gik galt",
              Priority: "high",
            },
            body: text,
          };
  try {
    const response = await alertFetch(url, {
      ...init,
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (sendError) {
    // Alarmen selv må aldrig vælte appen.
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "Alarmen kunne ikke sendes",
        error: describeError(sendError),
      }),
    );
    return false;
  }
}
