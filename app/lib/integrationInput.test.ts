import { describe, expect, it } from "vitest";
import { validateKlaviyoKey, validateWebhookUrl } from "./integrationInput";

describe("webhook-adressen", () => {
  it("godtager offentlige https-adresser", () => {
    for (const url of [
      "https://hooks.zapier.com/hooks/catch/123/abc/",
      "https://hook.eu1.make.com/xyz",
      "https://fcbarcelona.example.com/hook",
    ]) {
      expect(validateWebhookUrl(url)).toMatchObject({ ok: true });
    }
  });

  it("afviser http, interne adresser og adresser med adgangskode", () => {
    for (const url of [
      "http://hooks.zapier.com/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://192.168.1.1/x",
      "https://172.20.0.1/x",
      "https://169.254.169.254/latest",
      "https://[::1]/x",
      "https://preaura-db/x",
      "https://bruger:kode@example.com/x",
      "ikke en adresse",
    ]) {
      expect(validateWebhookUrl(url), url).toMatchObject({ ok: false });
    }
  });
});

describe("Klaviyo-nøglen", () => {
  it("skal være en privat nøgle (pk_)", () => {
    expect(validateKlaviyoKey(" pk_abcdef1234567890 ")).toEqual({
      ok: true,
      key: "pk_abcdef1234567890",
    });
    expect(validateKlaviyoKey("XyZ123")).toMatchObject({ ok: false });
  });
});
