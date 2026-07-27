(() => {
  const header = document.querySelector("#header");
  const headerInner = header?.querySelector(".header-inner");
  const logo = document.querySelector("#logoWrapper");
  const desktopWrapper = document.querySelector("#mainNavWrapper");
  const desktopMenu = document.querySelector("#mainNavigation");
  const toggle = document.querySelector(".mobile-nav-toggle");
  const wrapper = document.querySelector("#mobileNavWrapper");
  const menu = document.querySelector("#mobileNavigation");
  const themeToggle = document.querySelector("[data-theme-toggle]");

  if (themeToggle instanceof HTMLButtonElement) {
    const root = document.documentElement;
    const applyTheme = (theme, persist = false) => {
      const isDark = theme === "dark";
      root.dataset.theme = isDark ? "dark" : "light";
      root.style.colorScheme = isDark ? "dark" : "light";
      themeToggle.setAttribute("aria-pressed", String(isDark));
      const action = isDark ? "Switch to light mode" : "Switch to dark mode";
      themeToggle.setAttribute("aria-label", action);
      themeToggle.title = action;
      if (persist) {
        try {
          localStorage.setItem("fcfl-theme", isDark ? "dark" : "light");
        } catch {
          // The selected theme still applies when storage is unavailable.
        }
      }
    };

    applyTheme(root.dataset.theme === "dark" ? "dark" : "light");
    themeToggle.addEventListener("click", () => {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
    });
  }

  if (!header || !headerInner || !logo || !desktopWrapper || !desktopMenu || !toggle || !wrapper || !menu) return;

  let previouslyFocused = null;
  let desktopRequiredWidth = 0;
  const capturedDesktopMinimum = 1190;

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

  const measureDesktopRequirement = () => {
    const headerStyle = getComputedStyle(header);
    const horizontalPadding = parseFloat(headerStyle.paddingLeft) + parseFloat(headerStyle.paddingRight);
    const measuringWrapper = desktopWrapper.cloneNode(true);
    measuringWrapper.removeAttribute("id");
    measuringWrapper.setAttribute("aria-hidden", "true");
    measuringWrapper.style.setProperty("display", "block", "important");
    measuringWrapper.style.setProperty("position", "absolute", "important");
    measuringWrapper.style.setProperty("width", "max-content", "important");
    measuringWrapper.style.setProperty("margin", "0", "important");
    measuringWrapper.style.setProperty("visibility", "hidden", "important");
    measuringWrapper.style.setProperty("pointer-events", "none", "important");
    measuringWrapper.style.setProperty("inset", "0 auto auto -10000px", "important");
    const measuringMenu = measuringWrapper.querySelector("#mainNavigation");
    measuringMenu?.style.setProperty("display", "block", "important");
    document.body.append(measuringWrapper);
    const menuWidth = measuringWrapper.getBoundingClientRect().width;
    measuringWrapper.remove();
    desktopRequiredWidth = Math.max(
      capturedDesktopMinimum,
      Math.ceil(Math.max(140, logo.getBoundingClientRect().width) + menuWidth + horizontalPadding),
    );
  };

  const updateResponsiveMode = () => {
    if (!desktopRequiredWidth) measureDesktopRequirement();
    const forceMobile = window.innerWidth < desktopRequiredWidth;
    document.body.classList.toggle("force-mobile-nav", forceMobile);
    if (!forceMobile && isOpen()) closeMenu(false);
  };

  measureDesktopRequirement();
  updateResponsiveMode();
  window.addEventListener("resize", updateResponsiveMode, { passive: true });
  document.fonts?.ready.then(() => {
    document.body.classList.remove("force-mobile-nav");
    measureDesktopRequirement();
    updateResponsiveMode();
  });

  const folderNav = document.querySelector("#folderNav");
  const folderToggle = folderNav?.querySelector(".folder-nav-toggle");
  if (folderNav && folderToggle) {
    folderToggle.addEventListener("click", () => {
      const expanded = folderNav.classList.toggle("expanded");
      folderToggle.setAttribute("aria-expanded", String(expanded));
      folderToggle.setAttribute("aria-label", expanded ? "Hide section navigation" : "Show section navigation");
    });
  }
})();
