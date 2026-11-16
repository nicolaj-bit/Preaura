import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Temaudvidelsens tekster findes på alle sprog. Kunden ser butikkens egen
// tekst, hvis butikken har skrevet en, og ellers standardteksten på sit eget
// sprog (locales/*.json). Temaeditoren følger butikkens sprog
// (locales/*.schema.json).

const ROOT = join(__dirname, "../extensions/preaura-preorder");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = (path: string) =>
  JSON.parse(read(path)) as Record<string, unknown>;

/** Alle nøgler i en indlejret oversættelsesfil, fx "preorder.button_text". */
function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

const blocks = readdirSync(join(ROOT, "blocks")).filter((f) =>
  f.endsWith(".liquid"),
);

describe("tekster i butikken", () => {
  const en = json("locales/en.default.json");
  const da = json("locales/da.json");

  it("dansk og engelsk har de samme tekster, og ingen er tomme", () => {
    expect(keys(da).sort()).toEqual(keys(en).sort());
    for (const file of [en, da]) {
      for (const key of keys(file)) {
        const value = key
          .split(".")
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], file);
        expect(String(value).trim(), key).not.toBe("");
      }
    }
  });

  it("hver tekst, blokkene slår op, findes", () => {
    const all = new Set(keys(en));
    for (const block of blocks) {
      const used = [
        ...read(`blocks/${block}`).matchAll(/'([\w.]+)' \| t\b/g),
      ].map((m) => m[1]);
      for (const key of used)
        expect(all.has(key), `${block}: ${key}`).toBe(true);
    }
  });

  it("standardtekster står kun i sprogfilerne — ikke som fast tekst i indstillingerne", () => {
    for (const block of blocks) {
      const schema = JSON.parse(
        read(`blocks/${block}`)
          .split("{% schema %}")[1]
          .split("{% endschema %}")[0],
      ) as { settings: { type: string; default?: unknown }[] };
      for (const s of schema.settings) {
        if (s.type === "text" || s.type === "textarea") {
          expect(s.default, `${block}`).toBeUndefined();
        }
      }
    }
  });
});

describe("tekster i temaeditoren", () => {
  const en = json("locales/en.default.schema.json");
  const da = json("locales/da.schema.json");

  it("dansk og engelsk har de samme tekster", () => {
    expect(keys(da).sort()).toEqual(keys(en).sort());
  });

  it("hver t:-nøgle i blokkenes indstillinger findes", () => {
    const all = new Set(keys(en));
    for (const block of blocks) {
      const schema = read(`blocks/${block}`).split("{% schema %}")[1];
      const used = [...schema.matchAll(/"t:([\w.]+)"/g)].map((m) => m[1]);
      expect(used.length, block).toBeGreaterThan(0);
      for (const key of used)
        expect(all.has(key), `${block}: ${key}`).toBe(true);
    }
  });
});
