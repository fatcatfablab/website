(() => {
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const REQUEST_TIMEOUT_MS = 12_000;

  const initializeGate = (gate) => {
    if (!(gate instanceof HTMLElement) || gate.dataset.fcflInitialized === "true") return;
    gate.dataset.fcflInitialized = "true";

    const form = gate.querySelector("form");
    const emailInput = gate.querySelector('input[type="email"]');
    const submit = gate.querySelector('button[type="submit"]');
    const status = gate.querySelector("[data-fcfl-email-status]");
    const mount = gate.querySelector("[data-fcfl-stripe-mount]");
    const endpoint = gate.dataset.endpoint;
    const publishableKey = gate.dataset.publishableKey;
    const capturedId = gate.dataset.capturedId;
    const mode = gate.dataset.mode;

    if (
      !(form instanceof HTMLFormElement) ||
      !(emailInput instanceof HTMLInputElement) ||
      !(submit instanceof HTMLButtonElement) ||
      !(status instanceof HTMLElement) ||
      !(mount instanceof HTMLElement) ||
      !endpoint ||
      !publishableKey ||
      !capturedId ||
      (mode !== "pricing-table" && mode !== "buy-button")
    ) {
      return;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (gate.dataset.fcflSubmitting === "true" || gate.dataset.fcflMounted === "true") return;

      const email = emailInput.value.trim();
      if (!EMAIL_PATTERN.test(email) || !emailInput.checkValidity()) {
        emailInput.reportValidity();
        return;
      }

      gate.dataset.fcflSubmitting = "true";
      submit.disabled = true;
      status.textContent = "Loading secure checkout…";
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            email,
            buy_button: String(mode === "buy-button"),
          }),
          signal: controller.signal,
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error("Session request failed");

        const info = await response.json();
        if (!info || typeof info !== "object" || Array.isArray(info)) {
          throw new Error("Session response is invalid");
        }

        const widget = document.createElement(
          mode === "buy-button" ? "stripe-buy-button" : "stripe-pricing-table",
        );
        widget.setAttribute(mode === "buy-button" ? "buy-button-id" : "pricing-table-id", capturedId);
        widget.setAttribute("publishable-key", publishableKey);

        if (typeof info.session === "string" && info.session.length > 0) {
          widget.setAttribute("customer-session-client-secret", info.session);
        } else if (typeof info.email === "string" && EMAIL_PATTERN.test(info.email)) {
          widget.setAttribute("customer-email", info.email);
        } else {
          throw new Error("Session response is incomplete");
        }

        mount.replaceChildren(widget);
        gate.dataset.fcflMounted = "true";
        form.hidden = true;
        status.textContent = "Secure checkout loaded.";
      } catch {
        status.textContent = "Checkout could not load. Please try again.";
        submit.disabled = false;
      } finally {
        window.clearTimeout(timeout);
        delete gate.dataset.fcflSubmitting;
      }
    });
  };

  const initializeAll = () => {
    document.querySelectorAll("[data-fcfl-email-gate]").forEach(initializeGate);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeAll, { once: true });
  } else {
    initializeAll();
  }
})();
