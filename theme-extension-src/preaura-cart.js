/*
 * PREAURA – kurven (app embed).
 *
 * Viser i kurvskuffen og på kurvsiden, at en forudbestilling ikke koster
 * noget i dag:
 *
 *   - under hver forudbestilt vare en kort linje («Intet at betale i dag …»),
 *     sat lige efter planens navn, som temaet selv viser,
 *   - over knappen til kassen to linjer: hvad der trækkes ved afsendelse, og
 *     hvad der betales i dag.
 *
 * Tallene kommer fra Shopifys egen kurv (/cart.js), ikke fra appen: siden
 * venter ikke på appens server, og beløbene er dem, Shopify faktisk trækker.
 *
 * Temaet røres ikke ud over de små elementer, vi selv indsætter. Bygger
 * temaet kurven om (fx når et antal ændres), sætter vi dem ind igen.
 */
(function () {
  "use strict";
  if (window.__preauraCart) return;
  window.__preauraCart = true;

  var MARK = "data-preaura-cart";
  var CART_AREA =
    'cart-drawer,cart-items,cart-drawer-items,cart-notification,form[action*="/cart"],[id*="cart" i],[class*="cart" i]';
  var CHECKOUT =
    'button[name="checkout"],input[name="checkout"],a[href$="/checkout"]';

  var config = {};
  var state = null; // { names: { plannavn: true }, later, today } eller null
  var timer = null;
  var observer = null;
  var stopped = false;

  // --- Beløb ----------------------------------------------------------------

  function group(cents, decimals, thousands, separator) {
    var parts = (cents / 100).toFixed(decimals).split(".");
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return parts[1] ? whole + separator + parts[1] : whole;
  }

  /** Som Shopifys money-filter: butikkens eget format, fx «{{amount_with_comma_separator}} kr». */
  function money(cents, currency) {
    var format = String(config.moneyFormat || "{{amount}}").replace(
      /<[^>]*>/g,
      "",
    );
    if (currency && config.currency && currency !== config.currency) {
      // Kunden handler i en anden valuta end butikkens: brug browserens format.
      var local = null;
      try {
        local = new Intl.NumberFormat(document.documentElement.lang || void 0, {
          style: "currency",
          currency: currency,
        }).format(cents / 100);
      } catch (e) {
        local = null; // falder tilbage til butikkens format
      }
      if (local) return local;
    }
    var match = /\{\{\s*(\w+)\s*\}\}/.exec(format);
    var styles = {
      amount_no_decimals: [0, ",", "."],
      amount_with_comma_separator: [2, ".", ","],
      amount_no_decimals_with_comma_separator: [0, ".", ","],
      amount_with_apostrophe_separator: [2, "'", "."],
      amount_with_space_separator: [2, " ", ","],
      amount_no_decimals_with_space_separator: [0, " ", ","],
      amount_with_period_and_space_separator: [2, " ", "."],
    };
    var s = (match && styles[match[1]]) || [2, ",", "."];
    var amount = group(cents, s[0], s[1], s[2]);
    return match ? format.replace(match[0], amount) : amount;
  }

  // --- Kurven ---------------------------------------------------------------

  /**
   * PREAURAs egne planer. Skal svare til PLAN_NAME og GROUP_OPTION i
   * app/sync/plans.ts (en test holder dem ens). Shopifys /cart.js oplyser
   * ikke, hvad der trækkes i dag, så planen genkendes på navn og valg.
   * Vores planer trækker intet ved køb og hele beløbet ved afsendelse.
   */
  var PLAN_NAME = "Forudbestilling";
  var PLAN_OPTION = "Leverance";

  function isOurs(plan) {
    return (
      plan.fixed_selling_plan === true &&
      plan.name === PLAN_NAME &&
      (plan.options || []).some(function (o) {
        return o && o.name === PLAN_OPTION;
      })
    );
  }

  /** Hvad i kurven betales senere — og hvad i dag? */
  function summarize(cart) {
    var names = {};
    var later = 0;
    var found = false;
    (cart.items || []).forEach(function (item) {
      var a = item.selling_plan_allocation;
      if (!a || !a.selling_plan) return;
      // Linjens pris efter rabatter.
      var line = Number(item.final_line_price) || 0;
      var now = Number(a.checkout_charge_amount);
      var rest = Number(a.remaining_balance_charge_amount);
      if (rest > 0 && !isNaN(now)) {
        // Oplyser Shopify fordelingen, bruges den.
        later += Math.round((line * rest) / (rest + now));
      } else if (isOurs(a.selling_plan)) {
        later += line;
      } else {
        return;
      }
      found = true;
      names[String(a.selling_plan.name).trim()] = true;
    });
    if (!found) return null;
    var total = Number(cart.total_price) || 0;
    return {
      names: names,
      later: later,
      today: Math.max(0, total - later),
      currency: cart.currency,
    };
  }

  function refresh() {
    var shopify = window.Shopify;
    var root = (shopify && shopify.routes && shopify.routes.root) || "/";
    return fetch(root + "cart.js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (cart) {
        if (!cart || stopped) return;
        state = summarize(cart);
        decorate();
      })
      .catch(function () {
        /* Uden svar lader vi temaets kurv være, som den er. */
      });
  }

  // --- Indsæt i temaets kurv -------------------------------------------------

  function ours(node) {
    return node.closest && node.closest("[" + MARK + "]");
  }

  function inCart(el) {
    return !el.closest('form[action*="/cart/add"]') && !!el.closest(CART_AREA);
  }

  /** Noten under hver forudbestilt vare, lige efter planens navn. */
  function decorateLines() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var hits = [];
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      var parent = n.parentElement;
      if (!parent || !state.names[n.nodeValue.trim()]) continue;
      if (ours(parent) || parent.closest("script,style,template,option")) continue;
      if (inCart(parent)) hits.push(parent);
    }
    hits.forEach(function (el) {
      var next = el.nextElementSibling;
      if (next && next.hasAttribute(MARK)) return;
      var tag = /^(P|DIV|SPAN|DD|LI|SMALL)$/.test(el.tagName) ? el.tagName : "P";
      var note = document.createElement(tag);
      note.className = el.className;
      note.classList.add("preaura-cart-note");
      note.setAttribute(MARK, "note");
      note.textContent = config.lineNote || "";
      el.insertAdjacentElement("afterend", note);
    });
  }

  /** Står knappen i en vandret række, sættes beløbene over hele rækken. */
  function slot(button) {
    var target = button;
    for (var i = 0; i < 4; i++) {
      var p = target.parentElement;
      if (!p || p === document.body) break;
      var cs = window.getComputedStyle(p);
      var row =
        (/flex/.test(cs.display) && !/column/.test(cs.flexDirection)) ||
        (/grid/.test(cs.display) &&
          String(cs.gridTemplateColumns || "").trim().split(/\s+/).length > 1);
      if (!row) break;
      target = p;
    }
    return target;
  }

  function row(label, value) {
    var div = document.createElement("div");
    var a = document.createElement("span");
    var b = document.createElement("span");
    a.textContent = label;
    b.textContent = value;
    div.appendChild(a);
    div.appendChild(b);
    return div;
  }

  /** Beløbene over knappen til kassen. */
  function decorateTotals() {
    var buttons = document.querySelectorAll(CHECKOUT);
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      if (button.tagName === "A" && !inCart(button)) continue;
      var target = slot(button);
      var prev = target.previousElementSibling;
      var box = prev && prev.getAttribute(MARK) === "totals" ? prev : null;
      var later = money(state.later, state.currency);
      var today = money(state.today, state.currency);
      var key = later + "|" + today;
      if (box && box.getAttribute("data-key") === key) continue;
      if (!box) {
        box = document.createElement("div");
        box.className = "preaura-cart-totals";
        box.setAttribute(MARK, "totals");
        target.insertAdjacentElement("beforebegin", box);
      }
      box.setAttribute("data-key", key);
      box.textContent = "";
      box.appendChild(row(config.laterLabel || "", later));
      box.appendChild(row(config.todayLabel || "", today));
    }
  }

  function clear() {
    var mine = document.querySelectorAll("[" + MARK + "]");
    for (var i = 0; i < mine.length; i++) mine[i].remove();
  }

  function decorate() {
    if (!document.body) return;
    if (!state) {
      clear();
      return;
    }
    if (config.lineNote) decorateLines();
    if (config.showTotals) decorateTotals();
  }

  /** Temaet har bygget noget om: sæt vores elementer ind igen (uden nyt kald). */
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      decorate();
    }, 80);
  }

  // --- Hold øje med kurven ---------------------------------------------------

  function isCartChange(url) {
    return /\/cart\/(add|change|update|clear)(\.js|\.json)?(\?|$)/.test(
      String(url || ""),
    );
  }

  function watch() {
    if (typeof window.fetch === "function") {
      var realFetch = window.fetch;
      window.fetch = function (input) {
        var url = typeof input === "string" ? input : input && input.url;
        var result = realFetch.apply(this, arguments);
        if (isCartChange(url)) {
          result.then(refresh, function () {});
        }
        return result;
      };
    }
    if (typeof XMLHttpRequest !== "undefined") {
      var open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function () {
        if (isCartChange(arguments[1])) this.addEventListener("load", refresh);
        return open.apply(this, arguments);
      };
    }
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(function (records) {
        if (!state) return;
        for (var i = 0; i < records.length; i++) {
          var t = records[i].target;
          if (!(t.nodeType === 1 && ours(t))) return schedule();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function start() {
    var el = document.querySelector("script[data-preaura-cart-config]");
    if (!el) return;
    try {
      config = JSON.parse(el.textContent || "{}");
    } catch (e) {
      config = null;
    }
    if (!config) return;
    watch();
    if (config.count > 0) refresh();
  }

  /** Til tests: stop med at holde øje med siden. */
  function stop() {
    if (observer) observer.disconnect();
    stopped = true;
    state = null;
    config = {};
  }

  window.PreauraCart = {
    money: money,
    summarize: summarize,
    refresh: refresh,
    stop: stop,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
