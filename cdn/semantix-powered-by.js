/**
 * Semantix "Powered by" badge — isolated from inject/rerank/zero-grid paint.
 *
 * Shows only when:
 *   1. siteConfig.poweredBy.enabled === true  (Wine House is gated server-side)
 *   2. native search was empty and Semantix built a zero-results recovery grid
 *      ([data-semantix-zero-grid]). Inject/rerank on native hits do not count.
 *
 * Does not clone cards, does not call injectIntoGrid, does not change ranking.
 */
(function () {
  "use strict";

  if (window.__semantix_powered_by_v1) return;
  window.__semantix_powered_by_v1 = true;

  var BAR_ID = "semantix-powered-bar";
  var LINK_ID = "semantix-powered-preview";
  var MARKERS = '[data-semantix-zero-grid], .semantix-zero-grid';

  var observer = null;
  var timer = null;

  function poweredByCfg() {
    var settings = window.SemantixSettings || {};
    var site = settings.siteConfig || {};
    var pb = site.poweredBy;
    return pb && typeof pb === "object" ? pb : {};
  }

  function isEnabled() {
    return poweredByCfg().enabled === true;
  }

  function hasZeroResultsGrid() {
    try {
      return !!document.querySelector(MARKERS);
    } catch (e) {
      return false;
    }
  }

  function resultsHost() {
    var marked = document.querySelector("[data-semantix-zero-grid], .semantix-zero-grid");
    if (!marked) return null;

    var category = document.querySelector(".categoryPage");
    if (category && category.contains(marked)) return category;

    return (
      marked.closest(".catalogList, .catalog_category, main, #main") ||
      marked.parentElement
    );
  }

  function unmount() {
    var bar = document.getElementById(BAR_ID);
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  function mount() {
    if (!isEnabled() || !hasZeroResultsGrid()) {
      unmount();
      return;
    }
    if (document.getElementById(BAR_ID)) return;

    var cfg = poweredByCfg();
    var href = cfg.href || "https://www.semantix-ai.com";
    var logoUrl = cfg.logoUrl;
    if (!logoUrl) return;

    var host = resultsHost();
    if (!host) return;

    var bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.setAttribute("data-semantix-powered", "1");
    bar.style.cssText =
      "display:flex;justify-content:center;align-items:center;width:100%;padding:24px 15px 28px;box-sizing:border-box;";

    var a = document.createElement("a");
    a.id = LINK_ID;
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", "Powered by semantix");
    a.style.cssText = "display:inline-flex;line-height:0;text-decoration:none;";

    var img = document.createElement("img");
    img.src = logoUrl;
    img.alt = "Powered by semantix";
    img.style.cssText =
      "height:44px;width:auto;display:block;background:transparent;border:0;";

    a.appendChild(img);
    bar.appendChild(a);
    host.appendChild(bar);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      try {
        mount();
      } catch (e) {}
    }, 80);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  function boot() {
    if (!isEnabled()) return;
    if (document.body) startObserver();
    else document.addEventListener("DOMContentLoaded", startObserver);
  }

  boot();
  document.addEventListener("semantix:siteconfig", boot);

  var attempts = 0;
  var poll = setInterval(function () {
    attempts += 1;
    boot();
    if (isEnabled() || attempts > 40) clearInterval(poll);
  }, 250);
})();
