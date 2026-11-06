/*
 * PREAURA – tillæg til forudbestillingsblokken: venteliste, antal tilbage i
 * den aktuelle leverance og tidslinje over leverancerne.
 *
 * Hentes af kernen (preaura-preorder.js) kun, når siden kan bruge det. Kernen
 * kalder render(); tillægget lægger renderExtras() og startExtras() til.
 *
 * Resttal og tidslinje: når siden er indlæst, hentes den aktuelle leverance,
 * antal tilbage i den og tidslinjen fra appen (/apps/preaura/availability) i
 * ét kald for hele produktet. Produktsider caches, så tal i sidens HTML kan
 * være timer gamle; derfor bruges kun det friske svar. Det hentes igen hvert
 * minut, mens siden er synlig. Bliver leverancen udsolgt imens, følger plan,
 * dato, besked og købsknap med. Uden svar vises hverken tal eller tidslinje.
 *
 * Ventelisten: kan varianten hverken købes på lager eller forudbestilles,
 * vises blokkens e-mailfelt (hvis det er slået til). Tilmeldingen sendes til
 * appen gennem app-proxyen (/apps/preaura/waitlist), kun når kunden selv
 * trykker på knappen. Svaret er det samme, uanset om e-mailen stod på listen.
 */
(function () {
  "use strict";

  var WAITLIST_URL = "/apps/preaura/waitlist";
  var LIVE_URL = "/apps/preaura/availability";
  var LIVE_REFRESH_MS = 60000;

  function install(api) {
    var Controller = api.Controller;
    var PLANS = api.PLANS;
    var numericId = api.numericId;
    var formatDate = api.formatDate;
    var findButton = api.findButton;

    Controller.prototype.startExtras = function () {
      if (this.extrasStarted) return;
      this.extrasStarted = true;
      var root = this.root;
      this.waitlistEl = root.querySelector("[data-preaura-waitlist]");
      this.available = this.data.available || {};
      this.remainingEl = root.querySelector("[data-preaura-remaining]");
      this.timelineEl = root.querySelector("[data-preaura-timeline]");
      this.buttonDisabledByUs = null;
      this.bindWaitlist();
      this.startLive();
    };

    /** Kaldes af kernens render(). Returnerer, om ventelisten vises. */
    Controller.prototype.renderExtras = function (variantId, variant, live) {
      if (!this.extrasStarted) return false;
      if (variantId !== this.extrasVariant) this.setWaitlistStatus("");
      this.extrasVariant = variantId;
      var s = this.settings;
      var active = Boolean(variant && variant.active);
      var liveSoldOut = Boolean(active && live && !live.current);
      this.renderRemaining(active ? live : null);
      this.renderTimeline(active ? live : null, variant);
      this.setButtonDisabled(
        liveSoldOut && this.available[variantId] !== false,
      );
      // Kan varianten hverken købes på lager eller forudbestilles?
      var waitlist = Boolean(
        s.waitlist &&
        this.waitlistEl &&
        (this.available[variantId] === false || liveSoldOut),
      );
      if (this.waitlistEl) this.waitlistEl.hidden = !waitlist;
      return waitlist;
    };

    /** Er der varianter på forudbestilling på siden? Ellers hentes intet. */
    Controller.prototype.hasPreorder = function () {
      for (var id in this.variants) {
        if (this.variants[id] && this.variants[id].active) return true;
      }
      return false;
    };

    Controller.prototype.startLive = function () {
      if (!this.data.product || !this.hasPreorder()) return;
      var self = this;
      var load = function () {
        self.fetchLive();
      };
      // Først når siden er færdig, og browseren har tid: produktsiden venter
      // aldrig på kaldet.
      var later = function () {
        if (window.requestIdleCallback) {
          window.requestIdleCallback(load, { timeout: 2000 });
        } else {
          setTimeout(load, 200);
        }
      };
      if (document.readyState === "complete") later();
      else window.addEventListener("load", later, { once: true });
      this.liveTimer = setInterval(function () {
        if (document.visibilityState !== "hidden") load();
      }, LIVE_REFRESH_MS);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") load();
      });
    };

    Controller.prototype.fetchLive = function () {
      if (this.fetching || !this.root.isConnected) return;
      var self = this;
      this.fetching = true;
      var url =
        LIVE_URL +
        "?product_id=" +
        encodeURIComponent(numericId(this.data.product));
      var init = {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      };
      // Lav prioritet: kaldet må ikke konkurrere med sidens egne filer. Ældre
      // browsere ignorerer feltet.
      init.priority = "low";
      fetch(url, init)
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (json) {
          if (!json || typeof json.variants !== "object") return;
          self.live = json.variants;
          self.updatePlans();
          if (self.variantId) self.render(self.variantId);
        })
        .catch(function () {
          // Intet svar: intet tal og ingen tidslinje. Resten virker som før.
        })
        .then(function () {
          self.fetching = false;
        });
    };

    /** Kurven skal bruge den plan og dato, siden viser. */
    Controller.prototype.updatePlans = function () {
      var s = this.settings;
      for (var id in this.live) {
        var variant = this.variants[id];
        var live = this.live[id];
        if (!variant || !variant.active) continue;
        if (live.current) {
          PLANS[id] = {
            sellingPlan: numericId(live.current.sellingPlanId),
            label:
              variant.mode === "DELIVERY" ? s.deliveryLabel : s.shippingLabel,
            date: formatDate(live.current.date, this.data.locale),
          };
        } else {
          delete PLANS[id];
        }
      }
    };

    Controller.prototype.renderRemaining = function (live) {
      var el = this.remainingEl;
      if (!el) return;
      var s = this.settings;
      var remaining = live && live.current ? live.current.remaining : null;
      var threshold = Number(s.remainingThreshold);
      var show =
        s.showRemaining &&
        typeof remaining === "number" &&
        remaining > 0 &&
        (!isFinite(threshold) || threshold <= 0 || remaining <= threshold);
      el.hidden = !show;
      this.setText(
        el,
        show
          ? String(s.remainingText || "Kun {antal} tilbage i denne leverance.")
              .split("{antal}")
              .join(String(remaining))
          : "",
      );
    };

    Controller.prototype.renderTimeline = function (live, variant) {
      var el = this.timelineEl;
      if (!el) return;
      var s = this.settings;
      var list = el.querySelector("[data-preaura-timeline-list]");
      var heading = el.querySelector("[data-preaura-timeline-heading]");
      var items = live && live.timeline ? live.timeline : [];
      // Én leverance: beskeden over siger allerede det samme.
      if (!s.timeline || !list || items.length < 2) {
        el.hidden = true;
        if (list) list.textContent = "";
        return;
      }
      var label =
        variant && variant.mode === "DELIVERY"
          ? s.deliveryLabel
          : s.shippingLabel;
      this.setText(heading, label);
      var states = {
        SOLD_OUT: s.timelineSoldOut || "udsolgt",
        CURRENT: s.timelineCurrent || "nuværende",
        UPCOMING: s.timelineUpcoming || "kommende",
      };
      list.textContent = "";
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var li = document.createElement("li");
        var date = document.createElement("span");
        date.className = "preaura__date";
        date.textContent = formatDate(item.date, this.data.locale);
        // Usynlig skilletegn, så en skærmlæser læser «dato – tilstand».
        var sep = document.createElement("span");
        sep.className = "preaura__sep";
        sep.textContent = " – ";
        var state = document.createElement("span");
        state.className = "preaura__state";
        state.textContent = states[item.state] || "";
        li.appendChild(date);
        li.appendChild(sep);
        li.appendChild(state);
        if (item.state === "CURRENT") li.setAttribute("aria-current", "true");
        li.setAttribute("data-state", item.state);
        list.appendChild(li);
      }
      el.hidden = false;
    };

    /**
     * Er leverancen udsolgt, mens kunden står på siden, deaktiveres temaets
     * købsknap — og genaktiveres, når der igen er noget at købe. Knapper, temaet
     * selv har deaktiveret, røres ikke.
     */
    Controller.prototype.setButtonDisabled = function (disabled) {
      var button = this.form && findButton(this.form);
      if (disabled) {
        if (button && !button.disabled) {
          button.disabled = true;
          this.buttonDisabledByUs = button;
        }
      } else if (this.buttonDisabledByUs) {
        this.buttonDisabledByUs.disabled = false;
        this.buttonDisabledByUs = null;
      }
    };

    // --- Venteliste ------------------------------------------------------------

    Controller.prototype.bindWaitlist = function () {
      var el = this.waitlistEl;
      if (!el) return;
      var self = this;
      this.emailEl = el.querySelector("[data-preaura-waitlist-email]");
      this.trapEl = el.querySelector("[data-preaura-waitlist-trap]");
      this.submitEl = el.querySelector("[data-preaura-waitlist-submit]");
      this.statusEl = el.querySelector("[data-preaura-waitlist-status]");
      if (this.submitEl) {
        this.submitEl.addEventListener("click", function () {
          self.submitWaitlist();
        });
      }
      if (this.emailEl) {
        // Feltet ligger ikke i sin egen formular (blokken kan ligge inde i
        // temaets produktformular). Enter må ikke lægge varen i kurven.
        this.emailEl.addEventListener("keydown", function (event) {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          self.submitWaitlist();
        });
      }
    };

    Controller.prototype.setWaitlistStatus = function (text) {
      this.setText(this.statusEl, text);
    };

    Controller.prototype.submitWaitlist = function () {
      var s = this.settings;
      var self = this;
      if (this.sending || !this.emailEl || !this.variantId) return;
      var email = String(this.emailEl.value || "").trim();
      if (
        !email ||
        (this.emailEl.checkValidity && !this.emailEl.checkValidity())
      ) {
        this.setWaitlistStatus(s.waitlistInvalid);
        return;
      }
      var body = new URLSearchParams();
      body.set("email", email);
      body.set("variant_id", this.variantId);
      body.set("website", this.trapEl ? this.trapEl.value : "");
      this.sending = true;
      if (this.submitEl) this.submitEl.disabled = true;
      fetch(WAITLIST_URL, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: body,
        credentials: "same-origin",
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (json) {
              if (response.ok && json && json.ok) {
                self.emailEl.value = "";
                self.setWaitlistStatus(s.waitlistSuccess);
              } else if (json && json.error === "invalid_email") {
                self.setWaitlistStatus(s.waitlistInvalid);
              } else {
                self.setWaitlistStatus(s.waitlistError);
              }
            });
        })
        .catch(function () {
          self.setWaitlistStatus(s.waitlistError);
        })
        .then(function () {
          self.sending = false;
          if (self.submitEl) self.submitEl.disabled = false;
        });
    };
  }

  if (window.PreauraPreorder && window.PreauraPreorder.extend) {
    window.PreauraPreorder.extend(install);
  }
})();
