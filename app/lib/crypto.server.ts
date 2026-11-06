import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

// Kryptering af hemmeligheder og kundeoplysninger i databasen (AES-256-GCM).
// Nøglen står i miljøvariablen PREAURA_ENCRYPTION_KEY; på Render laves den
// selv (render.yaml). Uden nøglen nægter appen at gemme noget krypteret.

function key() {
  const secret = process.env.PREAURA_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "PREAURA_ENCRYPTION_KEY mangler. Uden den kan nøgler og kundeoplysninger ikke gemmes krypteret.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64")))
    .join(":");
}

export function decrypt(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || data == null) {
    throw new Error("Ukendt krypteringsformat.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** De sidste fire tegn — det eneste, admin nogensinde viser af en hemmelighed. */
export function last4(value: string) {
  return value.slice(-4);
}

export function randomSecret() {
  return randomBytes(32).toString("hex");
}

/**
 * Envejs-nøgle til en e-mail (HMAC-SHA256). Samme e-mail giver altid samme
 * nøgle, men e-mailen kan ikke læses ud af den. Bruges til at finde dubletter
 * og kundens tilmeldinger, uden at e-mailen skal dekrypteres.
 */
export function hashEmail(email: string) {
  return createHmac(
    "sha256",
    createHash("sha256")
      .update(`email:${key().toString("hex")}`)
      .digest(),
  )
    .update(normalizeEmail(email))
    .digest("hex");
}

/** Små bogstaver og uden mellemrum. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
