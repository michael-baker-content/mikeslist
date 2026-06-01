(function () {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function canAnimate() {
    return !reducedMotion.matches && typeof Element.prototype.animate === "function";
  }

  function closeMenu(header) {
    const toggle = header.querySelector(".menu-toggle");
    header.classList.remove("nav-open");
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.setAttribute("aria-label", "Open menu");
  }

  function animateMenuButton(toggle, isOpen) {
    toggle.classList.remove("menu-toggle-activated");
    window.requestAnimationFrame(() => toggle.classList.add("menu-toggle-activated"));
    window.setTimeout(() => toggle.classList.remove("menu-toggle-activated"), 420);
    if (!canAnimate()) return;
    toggle.animate([
      { transform: "scale(1) rotate(0deg)" },
      { transform: `scale(0.9) rotate(${isOpen ? "-7deg" : "7deg"})`, offset: 0.38 },
      { transform: `scale(1.08) rotate(${isOpen ? "4deg" : "-4deg"})`, offset: 0.72 },
      { transform: "scale(1) rotate(0deg)" }
    ], {
      duration: 360,
      easing: "cubic-bezier(.18,.89,.32,1.28)"
    });
  }

  function animateMenuItems(nav, isOpen) {
    if (!canAnimate() || !isOpen) return;
    [...nav.children].forEach((item, index) => {
      item.animate([
        { opacity: 0, transform: "translateY(-10px) scale(0.96)" },
        { opacity: 1, transform: "translateY(3px) scale(1.02)", offset: 0.7 },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ], {
        duration: 300 + index * 34,
        delay: index * 38,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "both"
      });
    });
  }

  function animateSelection(target) {
    target.classList.remove("nav-selection-pulse");
    window.requestAnimationFrame(() => target.classList.add("nav-selection-pulse"));
    window.setTimeout(() => target.classList.remove("nav-selection-pulse"), 420);
    if (!canAnimate()) return;
    target.animate([
      { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(15, 107, 95, 0)" },
      { transform: "scale(0.97)", boxShadow: "0 0 0 7px rgba(15, 107, 95, 0.14)", offset: 0.42 },
      { transform: "scale(1.03)", boxShadow: "0 0 0 3px rgba(15, 107, 95, 0.08)", offset: 0.72 },
      { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(15, 107, 95, 0)" }
    ], {
      duration: 360,
      easing: "cubic-bezier(.18,.89,.32,1.2)"
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".topbar").forEach((header) => {
      const toggle = header.querySelector(".menu-toggle");
      const nav = header.querySelector(".nav-actions");
      if (!toggle || !nav) return;

      toggle.addEventListener("click", () => {
        const isOpen = header.classList.toggle("nav-open");
        toggle.setAttribute("aria-expanded", String(isOpen));
        toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
        animateMenuButton(toggle, isOpen);
        animateMenuItems(nav, isOpen);
      });

      nav.addEventListener("click", (event) => {
        const selection = event.target.closest("a, button");
        if (!selection) return;
        animateSelection(selection);
        if (selection.matches("a")) {
          window.setTimeout(() => closeMenu(header), canAnimate() ? 130 : 0);
        }
      });
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 720) {
        document.querySelectorAll(".topbar.nav-open").forEach(closeMenu);
      }
    });
  });
})();
