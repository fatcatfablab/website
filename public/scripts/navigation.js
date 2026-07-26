(() => {
  const header = document.querySelector("#header");
  const toggle = document.querySelector(".mobile-nav-toggle");
  const wrapper = document.querySelector("#mobileNavWrapper");
  const menu = document.querySelector("#mobileNavigation");

  if (!header || !toggle || !wrapper || !menu) return;

  let previouslyFocused = null;

  const menuLinks = () => Array.from(menu.querySelectorAll("a[href]"));
  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";

  const openMenu = () => {
    previouslyFocused = document.activeElement;
    wrapper.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation");
    header.classList.add("is-open");
    document.body.classList.add("mobile-menu-open");
    const firstLink = menuLinks()[0];
    if (firstLink) {
      requestAnimationFrame(() => {
        if (isOpen()) firstLink.focus();
      });
    }
  };

  const closeMenu = (restoreFocus = true) => {
    wrapper.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
    header.classList.remove("is-open");
    document.body.classList.remove("mobile-menu-open");

    if (restoreFocus && previouslyFocused instanceof HTMLElement) {
      previouslyFocused.focus();
    } else if (restoreFocus) {
      toggle.focus();
    }
  };

  toggle.addEventListener("click", () => {
    if (isOpen()) closeMenu();
    else openMenu();
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key !== "Tab") return;
    const links = menuLinks();
    if (!links.length) return;
    const first = links[0];
    const last = links[links.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      toggle.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      toggle.focus();
    }
  });

  toggle.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Tab" && event.shiftKey && isOpen()) {
      event.preventDefault();
      menuLinks().at(-1)?.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (isOpen() && event.target instanceof Node && !header.contains(event.target)) {
      closeMenu();
    }
  });

  menu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) {
      closeMenu(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      closeMenu();
    }
  });

  const desktop = window.matchMedia("(min-width: 800px)");
  desktop.addEventListener("change", ({ matches }) => {
    if (matches && isOpen()) closeMenu(false);
  });
})();
