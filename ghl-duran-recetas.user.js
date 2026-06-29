// ==UserScript==
// @name         Duran Ginecologia - Boton Recetas GHL
// @namespace    https://duranginecologia.com/
// @version      1.0.0
// @description  Inserta un boton de recetas solo en la subcuenta de Duran Ginecologia.
// @match        https://crm.viraltia.com/v2/location/oHE4xQTwNInUOTgcLcJJ/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function bootstrapDuranPrescriptionButton() {
  "use strict";

  const LOCATION_ID = "oHE4xQTwNInUOTgcLcJJ";
  const CUSTOM_MENU_LINK_ID = "eb28c946-6b6b-46db-982c-51a50d3f399e";
  const CONTACT_STORAGE_KEY = "duranRecetasContactId";
  const BUTTON_ID = "duran-recetas-contact-button";
  const BUTTON_STYLE_ID = "duran-recetas-contact-button-style";

  function getContactIdFromUrl() {
    const match = window.location.pathname.match(/\/contacts\/detail\/([^/?#]+)/);

    return match ? decodeURIComponent(match[1]) : "";
  }

  function getContactIdFromLinks() {
    const links = document.querySelectorAll('a[href*="/contacts/detail/"]');

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/contacts\/detail\/([^/?#]+)/);

      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }

    return "";
  }

  function getCurrentContactId() {
    return (
      getContactIdFromUrl() ||
      getContactIdFromLinks() ||
      window.sessionStorage.getItem(CONTACT_STORAGE_KEY) ||
      ""
    );
  }

  function rememberContactId() {
    const contactId = getContactIdFromUrl() || getContactIdFromLinks();

    if (contactId) {
      window.sessionStorage.setItem(CONTACT_STORAGE_KEY, contactId);
    }

    return contactId;
  }

  function isDuranLocation() {
    return window.location.pathname.includes(`/location/${LOCATION_ID}/`);
  }

  function isCustomMenuLinkPage() {
    return window.location.pathname.includes(
      `/custom-menu-link/${CUSTOM_MENU_LINK_ID}`,
    );
  }

  function getCustomMenuLinkUrl(contactId) {
    const url = new URL(
      `/v2/location/${LOCATION_ID}/custom-menu-link/${CUSTOM_MENU_LINK_ID}`,
      window.location.origin,
    );

    url.searchParams.set("contactId", contactId);
    url.searchParams.set("locationId", LOCATION_ID);

    return url.toString();
  }

  function openPrescriptionMenu() {
    const contactId = getCurrentContactId();

    if (!contactId) {
      window.alert("Abre primero un contacto para crear la receta.");
      return;
    }

    window.sessionStorage.setItem(CONTACT_STORAGE_KEY, contactId);
    window.location.assign(getCustomMenuLinkUrl(contactId));
  }

  function ensureStyles() {
    if (document.getElementById(BUTTON_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = BUTTON_STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        align-items: center;
        background: #9d2f63;
        border: 0;
        border-radius: 999px;
        box-shadow: 0 10px 28px rgba(31, 29, 30, 0.22);
        color: #fff;
        cursor: pointer;
        display: inline-flex;
        font-family: Inter, Arial, sans-serif;
        font-size: 13px;
        font-weight: 800;
        gap: 6px;
        min-height: 34px;
        padding: 0 14px;
        position: fixed;
        right: 92px;
        top: 86px;
        z-index: 2147483647;
      }

      #${BUTTON_ID}:hover {
        background: #812750;
      }

      #${BUTTON_ID}[hidden] {
        display: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureButton() {
    if (!isDuranLocation() || isCustomMenuLinkPage()) {
      document.getElementById(BUTTON_ID)?.remove();
      return;
    }

    const contactId = rememberContactId();
    const shouldShow = Boolean(contactId || getContactIdFromLinks());
    let button = document.getElementById(BUTTON_ID);

    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "Hacer receta";
      button.addEventListener("click", openPrescriptionMenu);
      document.body.appendChild(button);
    }

    button.hidden = !shouldShow;
  }

  function updatePrescriptionIframe() {
    if (!isCustomMenuLinkPage()) {
      return;
    }

    const contactId =
      new URLSearchParams(window.location.search).get("contactId") ||
      window.sessionStorage.getItem(CONTACT_STORAGE_KEY) ||
      "";

    if (!contactId) {
      return;
    }

    const frames = document.querySelectorAll("iframe[src]");

    frames.forEach((frame) => {
      try {
        const frameUrl = new URL(frame.src);

        if (frameUrl.searchParams.get("contactId") === contactId) {
          return;
        }

        frameUrl.searchParams.set("locationId", LOCATION_ID);
        frameUrl.searchParams.set("contactId", contactId);
        frame.src = frameUrl.toString();
      } catch {
        // Ignore frames without a valid URL.
      }
    });
  }

  function tick() {
    ensureStyles();
    ensureButton();
    updatePrescriptionIframe();
  }

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    window.setTimeout(tick, 150);
    return result;
  };

  window.history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    window.setTimeout(tick, 150);
    return result;
  };

  window.addEventListener("popstate", () => window.setTimeout(tick, 150));
  window.setInterval(tick, 800);
  tick();
})();
