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

  window.PreauraPreorder = { init: init, formatDate: formatDate };

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
