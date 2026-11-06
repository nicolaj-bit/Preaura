import { createHash } from "node:crypto";

// Tilmelding fra produktsiden (via Shopifys app-proxy).
//
// - Samme svar, uanset om e-mailen stod på listen i forvejen. Listen kan
//   derfor ikke bruges til at finde ud af, hvem der handler i butikken.
// - Begrænset pr. afsender (IP-adresse, som Shopify sender med) og pr. butik.
// - Et skjult felt fanger simple robotter: udfyldes det, svares der «tak»,
//   men intet gemmes.
// - Tilmeldingen gælder KUN beskeden om varen. Den er ikke en tilmelding til
//   nyhedsbrev, og formularen har ingen afkrydsningsfelter.

export const MAX_EMAIL_LENGTH = 254;

/** Bevidst enkel: noget@noget.noget, uden mellemrum. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignupInput = {
  email: unknown;
  variantId: unknown;
  /** Det skjulte felt. Skal være tomt. */
  trap: unknown;
};

export type SignupDeps = {
  /** Har butikken et aktivt abonnement? */
  hasAccess(): Promise<boolean>;
  /** Variantens produkt i Shopify. Null, hvis varianten ikke findes. */
  productOf(variantId: string): Promise<string | null>;
  add(input: {
    productId: string;
    variantId: string;
    email: string;
  }): Promise<void>;
};

export type SignupResult = {
  status: number;
  body: { ok: true } | { ok: false; error: SignupError };
};

export type SignupError =
  "invalid_email" | "invalid_variant" | "rate_limited" | "unavailable";

const OK: SignupResult = { status: 200, body: { ok: true } };
const fail = (status: number, error: SignupError): SignupResult => ({
  status,
  body: { ok: false, error },
});

// --- Begrænsning pr. afsender ----------------------------------------------

type Window = { count: number; resetAt: number };

/**
 * Tæller i hukommelsen med faste vinduer. Nulstilles ved genstart, hvilket
 * er i orden: det er et værn mod misbrug, ikke en optælling.
 */
export function createRateLimiter(
  rules: { limit: number; windowMs: number }[],
) {
  const windows = new Map<string, Window>();
  return {
    /** Sand, hvis forsøget er tilladt (og tælles med). */
    hit(key: string, now = Date.now()) {
      for (const [i, rule] of rules.entries()) {
        const id = `${i}:${key}`;
        const window = windows.get(id);
        if (window && window.resetAt > now && window.count >= rule.limit) {
          return false;
        }
      }
      for (const [i, rule] of rules.entries()) {
        const id = `${i}:${key}`;
        const window = windows.get(id);
        if (!window || window.resetAt <= now) {
          windows.set(id, { count: 1, resetAt: now + rule.windowMs });
        } else {
          window.count += 1;
        }
      }
      if (windows.size > 50_000) {
        for (const [id, window] of windows) {
          if (window.resetAt <= now) windows.delete(id);
        }
      }
      return true;
    },
  };
}

const MINUTE = 60_000;

/** Pr. afsender: 5 på 15 minutter og 20 i døgnet. */
export const senderLimiter = createRateLimiter([
  { limit: 5, windowMs: 15 * MINUTE },
  { limit: 20, windowMs: 24 * 60 * MINUTE },
]);

/** Pr. butik i alt — et loft, hvis mange afsendere bruges på én gang. */
export const shopLimiter = createRateLimiter([
  { limit: 500, windowMs: 60 * MINUTE },
]);

/** Afsenderen som en nøgle — IP-adressen gemmes ikke, heller ikke her. */
export function senderKey(shop: string, forwardedFor: string | null) {
  const ip = (forwardedFor ?? "").split(",")[0].trim() || "ukendt";
  return createHash("sha256").update(`${shop}|${ip}`).digest("hex");
}

/** Variantens id som gid. Godtager tal og gid. */
export function variantGid(value: unknown) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  if (/^\d+$/.test(text)) return `gid://shopify/ProductVariant/${text}`;
  if (/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(text)) return text;
  return null;
}

export async function handleSignup(
  shop: string,
  sender: string,
  input: SignupInput,
  deps: SignupDeps,
  limits = { sender: senderLimiter, shop: shopLimiter },
  now = Date.now(),
): Promise<SignupResult> {
  if (!limits.sender.hit(sender, now) || !limits.shop.hit(shop, now)) {
    return fail(429, "rate_limited");
  }
  // En robot har udfyldt det skjulte felt: svar som altid, gem intet.
  if (typeof input.trap === "string" && input.trap.trim() !== "") return OK;

  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    return fail(400, "invalid_email");
  }
  const variantId = variantGid(input.variantId);
  if (!variantId) return fail(400, "invalid_variant");

  if (!(await deps.hasAccess())) return fail(403, "unavailable");
  const productId = await deps.productOf(variantId);
  if (!productId) return fail(400, "invalid_variant");

  // Står e-mailen der allerede, sker der intet — og svaret er det samme.
  await deps.add({ productId, variantId, email });
  return OK;
}
