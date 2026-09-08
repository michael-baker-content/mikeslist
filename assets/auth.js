(function () {
  const adminPaths = new Set([
    "admin.html",
    "review.html",
    "venue-review.html",
    "event-review.html",
    "suggestions.html"
  ]);
  const publicHeaderPaths = new Set();
  const currentPath = window.location.pathname.replace(/^\//, "") || "index.html";

  async function fetchSession() {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) return { authenticated: false, admin: false, status: "public" };
      return response.json();
    } catch {
      return { authenticated: false, admin: false, status: "public" };
    }
  }

  function pathForLink(link) {
    try {
      return new URL(link.getAttribute("href"), window.location.href).pathname.replace(/^\//, "");
    } catch {
      return "";
    }
  }

  function syncAdminNavigation(session) {
    document.body.classList.toggle("auth-admin", Boolean(session.admin));

    if (adminPaths.has(currentPath) && !session.admin) {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    document.querySelectorAll("a[href]").forEach((link) => {
      if (!adminPaths.has(pathForLink(link))) return;
      link.hidden = !session.admin;
      link.setAttribute("aria-hidden", session.admin ? "false" : "true");
    });

    document.querySelectorAll(".nav-actions a[href]").forEach((link) => {
      if (!publicHeaderPaths.has(pathForLink(link))) return;
      link.hidden = Boolean(session.admin);
      link.setAttribute("aria-hidden", session.admin ? "true" : "false");
    });

    document.querySelectorAll("[data-admin-only]").forEach((node) => {
      node.hidden = !session.admin;
    });

    document.querySelectorAll("[data-logout-button]").forEach((button) => {
      button.hidden = !session.authenticated;
    });

    document.querySelectorAll(".nav-actions").forEach((nav) => {
      const utilityNav = ensureUtilityNavigation(nav);
      if (!session.authenticated && adminPaths.has(currentPath) && !nav.querySelector("[data-login-link]")) {
        const login = document.createElement("a");
        login.className = "source-link";
        login.href = `login.html?next=${encodeURIComponent(window.location.pathname || "/admin.html")}`;
        login.textContent = "Log In";
        login.dataset.loginLink = "true";
        nav.insertBefore(login, utilityNav);
      }

      nav.querySelectorAll("[data-login-link]").forEach((link) => {
        link.hidden = Boolean(session.authenticated);
      });

      if (!session.authenticated || nav.querySelector("[data-logout-button]")) return;
      const button = document.createElement("button");
      button.className = "source-link button-link";
      button.type = "button";
      button.textContent = "Log Out";
      button.dataset.logoutButton = "true";
      button.addEventListener("click", logout);
      utilityNav.insertBefore(button, utilityNav.querySelector(".theme-toggle"));
    });
  }

  function ensureUtilityNavigation(nav) {
    let group = nav.querySelector(".nav-utility-actions");
    if (!group) {
      group = document.createElement("div");
      group.className = "nav-utility-actions";
      group.setAttribute("aria-label", "Admin and display controls");
      nav.append(group);
    }

    const theme = nav.querySelector(":scope > .theme-toggle");
    const admin = nav.querySelector(':scope > a[data-admin-only][href="admin.html"]');
    if (admin) group.insertBefore(admin, group.firstChild);
    if (theme) group.append(theme);
    return group;
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "index.html";
  }

  async function initLoginForm() {
    const form = document.querySelector("#loginForm");
    if (!form) return;
    const input = document.querySelector("#accessKeyInput");
    const status = document.querySelector("#loginStatus");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "Checking access...";
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey: input.value })
      });
      if (!response.ok) {
        status.textContent = "That access key did not work.";
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "admin.html";
      window.location.href = next;
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll(".nav-actions").forEach(ensureUtilityNavigation);
    const session = await fetchSession();
    syncAdminNavigation(session);
    initLoginForm();

    document.querySelectorAll("[data-logout-button]").forEach((button) => {
      button.addEventListener("click", logout);
    });
  });
})();
