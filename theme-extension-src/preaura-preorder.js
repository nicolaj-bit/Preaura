/*
 * PREAURA – forudbestilling på produktsiden.
 *
 * Data om alle varianter ligger allerede på siden (blokkens JSON, læst fra
 * variantens metafelt i Liquid). Der laves ingen netværkskald.
 *
 * Det eneste, scriptet tilføjer i temaets egen DOM, er to skjulte felter i
 * produktformularen:
 *   - selling_plan: den aktive leverances plan
 *   - properties[<navn>]: datoen som synlig linjeegenskab. Shopify viser den
 *     i kurven, i checkout, på ordrebekræftelsen og på ordren — og fryser
 *     dermed kundens leveringsløfte fast i købsøjeblikket.
 *
 * Temaets variantvælger røres aldrig. Købsknappens tekst ændres kun, hvis
 * webshopejeren har slået det til i blokkens indstillinger.
 *
 * Mange temaer sender ikke formularen, som den står, men bygger deres egen
 * anmodning til /cart/add (fx ud fra temaets egne købsmuligheder). Derfor
 * gør scriptet også temaets egne anmodninger til /cart/add fuldstændige: er
 * varen en variant på forudbestilling, og mangler planen eller datoen, lægges
 * de på. Andre varianter og andre anmodninger røres ikke, og der laves ingen
 * ekstra netværkskald.
 *
 * Variantskifte opdages på to måder:
 *   1. Hændelser, som nyere temaer udsender (og change på formularen).
 *   2. En reserve, der jævnligt læser formularens skjulte felt name="id".
 *      Den redder os på temaer, der skifter variant uden at sige det.
 */
(function () {
  "use strict";

  var POLL_MS = 250;
  var FIELD_ATTR = "data-preaura-field";
  var VARIANT_EVENTS = [
    "variant:change",
    "variant:changed",
    "variant:update",
    "variant:updated",
    "product:variant-change",
    "on:variant:change",
  ];

  /**
   * Varianter på siden med en aktiv plan: variant-id → { sellingPlan, label,
   * date }. Fyldes af blokkene og bruges, når temaet selv sender til kurven.
   */
  var PLANS = {};

  function numericId(id) {
    var text = String(id == null ? "" : id);
    var slash = text.lastIndexOf("/");
    return slash >= 0 ? text.slice(slash + 1) : text;
  }

  /** "2026-12-01" → fx "1. december 2026" på butikkens sprog. */
  function formatDate(date, locale) {
    var value = new Date(date + "T12:00:00Z");
    try {
      return new Intl.DateTimeFormat(locale || undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(value);
    } catch (error) {
      return date;
    }
  }

  /**
   * Temaets produktformular: den med variantens id-felt OG en købsknap.
   * Nogle temaer (fx Dawn) har en ekstra formular til delbetaling med samme
   * action og eget id-felt, men uden købsknap — den skal ikke bruges.
   */
  function findForm(root) {
    var scopes = [
      root.closest(".shopify-section"),
      root.closest("section"),
      document,
    ];
    for (var i = 0; i < scopes.length; i++) {
      if (!scopes[i]) continue;
      var forms = scopes[i].querySelectorAll('form[action*="/cart/add"]');
      var fallback = null;
      for (var j = 0; j < forms.length; j++) {
        if (!forms[j].querySelector('[name="id"]')) continue;
        if (findButton(forms[j])) return forms[j];
        fallback = fallback || forms[j];
      }
      if (fallback) return fallback;
    }
    return null;
  }

  function readVariantId(form) {
    var input = form && form.querySelector('[name="id"]');
    return input ? numericId(input.value) : null;
  }

  function findButton(form) {
    return (
      form.querySelector('[type="submit"][name="add"]') ||
      form.querySelector('button[type="submit"]')
    );
  }

  function Controller(root) {
    this.root = root;
    var json = root.querySelector("script[data-preaura-data]");
    this.data = JSON.parse(json ? json.textContent : "{}");
    this.settings = this.data.settings || {};
    this.variants = this.data.variants || {};
    this.registerPlans();
    this.messageEl = root.querySelector("[data-preaura-message]");
    this.noteEl = root.querySelector("[data-preaura-note]");
    this.current = null; // { sellingPlan, label, date } når forudbestilling gælder
    this.variantId = null;
    this.form = null;
    this.button = null;
    this.buttonOriginal = null;
    this.onFormData = this.onFormData.bind(this);
    this.check = this.check.bind(this);
  }

  /** Lægger sidens varianter med aktiv plan i PLANS. */
  Controller.prototype.registerPlans = function () {
    var s = this.settings;
    for (var id in this.variants) {
      var v = this.variants[id];
      if (!v || !v.active || v.soldOut || !v.sellingPlanId || !v.date) continue;
      PLANS[id] = {
        sellingPlan: numericId(v.sellingPlanId),
        label: v.mode === "DELIVERY" ? s.deliveryLabel : s.shippingLabel,
        date: formatDate(v.date, this.data.locale),
      };
    }
  };

  Controller.prototype.start = function () {
    var self = this;
    this.attach(findForm(this.root));
    this.render(readVariantId(this.form) || numericId(this.data.selected));

    var later = function () {
      setTimeout(self.check, 0);
    };
    VARIANT_EVENTS.forEach(function (name) {
      document.addEventListener(name, later);
    });
    document.addEventListener("change", later, true);
    this.timer = setInterval(this.check, POLL_MS);
  };

  /** Binder til (en ny) produktformular. Temaer kan genskabe formularen. */
  Controller.prototype.attach = function (form) {
    if (this.form === form) return;
    if (this.form) this.form.removeEventListener("formdata", this.onFormData);
    this.restoreButton();
    this.form = form;
    this.button = null;
    if (form) form.addEventListener("formdata", this.onFormData);
  };

  /** Reserven: kører jævnligt og ved hændelser. */
  Controller.prototype.check = function () {
    if (!this.root.isConnected) {
      clearInterval(this.timer);
      return;
    }
    if (!this.form || !this.form.isConnected) {
      this.attach(findForm(this.root));
      this.variantId = null; // tving en ny rendering i den nye formular
    }
    var id = readVariantId(this.form);
    if (id && id !== this.variantId) {
      this.render(id);
    } else if (this.current && this.form && !this.fieldsPresent()) {
      // Temaet har genskabt formularens indhold: læg felterne ind igen.
      this.writeFields();
    }
  };

  Controller.prototype.render = function (variantId) {
    this.variantId = variantId;
    var variant = this.variants[variantId];
    var s = this.settings;

    if (!variant || !variant.active) {
      this.current = null;
      this.removeFields();
      this.restoreButton();
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    var label = variant.mode === "DELIVERY" ? s.deliveryLabel : s.shippingLabel;

    if (variant.soldOut || !variant.sellingPlanId || !variant.date) {
      // Alt udsolgt: tydelig besked, og hverken plan eller linjeegenskab.
      this.current = null;
      this.removeFields();
      this.restoreButton();
      this.setText(this.messageEl, s.soldOutMessage);
      if (this.noteEl) this.noteEl.hidden = true;
      return;
    }

    var date = formatDate(variant.date, this.data.locale);
    this.current = {
      sellingPlan: numericId(variant.sellingPlanId),
      label: label,
      date: date,
    };
    this.writeFields();
    this.setText(
      this.messageEl,
      String(s.message || "{label}: {dato}")
        .split("{label}")
        .join(label)
        .split("{dato}")
        .join(date),
    );
    if (this.noteEl) this.noteEl.hidden = false;
    this.applyButton();
  };

  Controller.prototype.setText = function (el, text) {
    if (el) el.textContent = text || "";
  };

  Controller.prototype.fieldsPresent = function () {
    return this.form.querySelectorAll("[" + FIELD_ATTR + "]").length === 2;
  };

  Controller.prototype.writeFields = function () {
    if (!this.form || !this.current) return;
    this.removeFields();
    this.addField("selling_plan", this.current.sellingPlan);
    this.addField("properties[" + this.current.label + "]", this.current.date);
  };

  Controller.prototype.addField = function (name, value) {
    var input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    input.setAttribute(FIELD_ATTR, "");
    // Til sidst i formularen, så værdien vinder over et eventuelt
    // selling_plan-felt fra temaets egne købsmuligheder.
    this.form.appendChild(input);
  };

  Controller.prototype.removeFields = function () {
    if (!this.form) return;
    var fields = this.form.querySelectorAll("[" + FIELD_ATTR + "]");
    for (var i = 0; i < fields.length; i++) fields[i].remove();
  };

  /**
   * Sikrer værdierne, når formularen sendes eller serialiseres med
   * new FormData(form) — også selvom temaet selv har et selling_plan-felt
   * (fx «Engangskøb»). Ændrer kun de data, der sendes, ikke temaets DOM.
   */
  Controller.prototype.onFormData = function (event) {
    if (!this.current) return;
    event.formData.set("selling_plan", this.current.sellingPlan);
    event.formData.set(
      "properties[" + this.current.label + "]",
      this.current.date,
    );
  };

  Controller.prototype.applyButton = function () {
    if (!this.settings.changeButtonText || !this.settings.buttonText) return;
    if (!this.form) return;
    var button = findButton(this.form);
    if (!button) return;
    var target = button.querySelector("span") || button;
    if (this.button !== target) {
      this.restoreButton();
      this.button = target;
      this.buttonOriginal = target.textContent;
    }
    target.textContent = this.settings.buttonText;
  };

  Controller.prototype.restoreButton = function () {
    if (this.button && this.buttonOriginal != null) {
      this.button.textContent = this.buttonOriginal;
    }
    this.button = null;
    this.buttonOriginal = null;
  };

  // --- Temaets egne anmodninger til kurven ----------------------------------

  function isCartAdd(url) {
    return /\/cart\/add(\.js|\.json)?(\?|$)/.test(String(url || ""));
  }

  /** Sætter plan og dato på én vare, hvis de mangler. */
  function completeItem(get, set) {
    var plan = PLANS[numericId(get("id"))];
    if (!plan) return;
    if (!get("selling_plan")) set("selling_plan", plan.sellingPlan);
    var key = "properties[" + plan.label + "]";
    if (!get(key)) set(key, plan.date);
  }

  function completeParams(params) {
    completeItem(
      function (k) {
        return params.get(k);
      },
      function (k, v) {
        params.set(k, v);
      },
    );
    // items[0][id]-formen, som nogle temaer bruger.
    for (var i = 0; params.has("items[" + i + "][id]"); i++) {
      (function (prefix) {
        completeItem(
          function (k) {
            var name =
              k.indexOf("properties[") === 0
                ? prefix + "[properties]" + k.slice("properties".length)
                : prefix + "[" + k + "]";
            return params.get(name);
          },
          function (k, v) {
            var name =
              k.indexOf("properties[") === 0
                ? prefix + "[properties]" + k.slice("properties".length)
                : prefix + "[" + k + "]";
            params.set(name, v);
          },
        );
      })("items[" + i + "]");
    }
  }

  function completeJson(text) {
    var body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      return text;
    }
    var items = body && Array.isArray(body.items) ? body.items : [body];
    items.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var plan = PLANS[numericId(item.id)];
      if (!plan) return;
      if (!item.selling_plan) item.selling_plan = plan.sellingPlan;
      item.properties = item.properties || {};
      if (!item.properties[plan.label]) item.properties[plan.label] = plan.date;
    });
    return JSON.stringify(body);
  }

  /** Returnerer en fuldstændig udgave af body, eller body uændret. */
  function completeBody(body) {
    try {
      if (typeof FormData !== "undefined" && body instanceof FormData) {
        completeParams(body);
        return body;
      }
      if (
        typeof URLSearchParams !== "undefined" &&
        body instanceof URLSearchParams
      ) {
        completeParams(body);
        return body;
      }
      if (typeof body === "string") {
        var trimmed = body.trim();
        if (trimmed.charAt(0) === "{") return completeJson(body);
        var params = new URLSearchParams(body);
        completeParams(params);
        return params.toString();
      }
    } catch (error) {
      if (window.console) console.error("PREAURA:", error);
    }
    return body;
  }

  function patchRequests() {
    if (window.__preauraCartPatched) return;
    window.__preauraCartPatched = true;

    if (typeof window.fetch === "function") {
      var originalFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : input && input.url;
        if (isCartAdd(url) && init && init.body != null) {
          init = Object.assign({}, init, { body: completeBody(init.body) });
        }
        return originalFetch.call(this, input, init);
      };
    }

    if (typeof XMLHttpRequest !== "undefined") {
      var open = XMLHttpRequest.prototype.open;
      var send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__preauraCartAdd = isCartAdd(url);
        return open.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        if (this.__preauraCartAdd && body != null) body = completeBody(body);
        return send.call(this, body);
      };
    }
  }

  function init(scope) {
    var roots = (scope || document).querySelectorAll("[data-preaura-root]");
    for (var i = 0; i < roots.length; i++) {
      if (roots[i].preauraController) continue;
      try {
        var controller = new Controller(roots[i]);
        roots[i].preauraController = controller;
        controller.start();
      } catch (error) {
        // En fejl i blokken må aldrig forhindre kunden i at handle.
        if (window.console) console.error("PREAURA:", error);
      }
    }
  }

  patchRequests();

  window.PreauraPreorder = {
    init: init,
    formatDate: formatDate,
    completeBody: completeBody,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
    });
  } else {
    init();
  }
  // Temaeditoren genindlæser sektioner uden at genindlæse siden.
  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})();
