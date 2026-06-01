(function () {
  const storageKey = "showExplorerTheme";
  const options = ["light", "dark"];
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let transitionTimer;
  let fallbackChoice = "system";

  function storedTheme() {
    try {
      return localStorage.getItem(storageKey);
    } catch (error) {
      return fallbackChoice;
    }
  }

  function storeTheme(choice) {
    fallbackChoice = choice;
    try {
      localStorage.setItem(storageKey, choice);
    } catch (error) {
      // Direct file access can block storage; keep the choice for this page load.
    }
  }

  function savedChoice() {
    const choice = storedTheme();
    return options.includes(choice) ? choice : "system";
  }

  function resolvedTheme(choice) {
    return choice === "system" ? (media.matches ? "dark" : "light") : choice;
  }

  function animateThemeChange() {
    if (!document.body) return;
    document.body.classList.remove("theme-transition");
    window.requestAnimationFrame(() => {
      document.body.classList.add("theme-transition");
      window.clearTimeout(transitionTimer);
      transitionTimer = window.setTimeout(() => {
        document.body.classList.remove("theme-transition");
      }, 650);
    });
  }

  function applyTheme(choice = savedChoice(), animate = false) {
    const theme = resolvedTheme(choice);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeChoice = choice;
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      const nextTheme = theme === "dark" ? "light" : "dark";
      button.dataset.nextTheme = nextTheme;
      button.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
      button.setAttribute("title", choice === "system" ? `Using system theme. Switch to ${nextTheme}.` : `Switch to ${nextTheme}.`);
    });
    if (animate) animateThemeChange();
  }

  window.showExplorerTheme = {
    apply: applyTheme,
    set(choice) {
      const nextChoice = options.includes(choice) ? choice : "system";
      storeTheme(nextChoice);
      applyTheme(nextChoice, true);
    },
    toggle() {
      const nextTheme = resolvedTheme(savedChoice()) === "dark" ? "light" : "dark";
      storeTheme(nextTheme);
      applyTheme(nextTheme, true);
    }
  };

  applyTheme();

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme();
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.addEventListener("click", () => window.showExplorerTheme.toggle());
    });
  });

  media.addEventListener("change", () => {
    if (savedChoice() === "system") applyTheme("system");
  });
})();
