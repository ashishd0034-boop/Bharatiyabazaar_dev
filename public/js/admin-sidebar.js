/**
 * BHARATIYA BAZAAR — UNIFIED ADMIN SIDEBAR & AUTH ENGINE
 * Shared across all admin pages.
 */

(function () {
  // 1. Session & Token Helpers
  function getAdminToken() {
    return sessionStorage.getItem("admin_token") || localStorage.getItem("bb_admin_token");
  }

  function setAdminToken(token) {
    sessionStorage.setItem("admin_token", token);
    localStorage.setItem("bb_admin_token", token);
  }

  function logoutAdmin() {
    sessionStorage.removeItem("admin_token");
    sessionStorage.removeItem("admin_user");
    localStorage.removeItem("bb_admin_token");
    window.location.href = "bb-admin-login.html";
  }

  // Export globally for page scripts
  window.getAdminToken = getAdminToken;
  window.setAdminToken = setAdminToken;
  window.logoutAdmin = logoutAdmin;

  // 2. Auth Guard: Redirect unauthenticated requests to login immediately
  const isLoginPage = window.location.pathname.endsWith("bb-admin-login.html");
  const token = getAdminToken();

  if (!isLoginPage && !token) {
    window.location.href = "bb-admin-login.html";
    return;
  }

  // 3. Extract Admin Profile from Token or Session
  function getCurrentAdmin() {
    const cached = sessionStorage.getItem("admin_user");
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
    if (!token) return null;
    try {
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map(function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join("")
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      return { name: "Administrator", email: "admin@bharatiyabazaar.com", role: "ADMIN" };
    }
  }

  // 4. Sidebar Rendering Engine
  function renderSidebar(activeKey) {
    const admin = getCurrentAdmin() || { name: "Administrator", role: "ADMIN", email: "admin@bb.com" };
    const isSuperAdmin = admin.role === "SUPER_ADMIN";

    // Create Backdrop
    let backdrop = document.getElementById("sbBackdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "sbBackdrop";
      backdrop.className = "sb-backdrop";
      backdrop.onclick = () => toggleSidebar(false);
      document.body.appendChild(backdrop);
    }

    // HTML Markup for Sidebar
    const sidebarHtml = `
      <aside class="admin-sidebar" id="adminSidebar">
        <!-- Brand Header -->
        <a href="bb-admin.html" class="sb-brand">
          <div class="sb-brand-badge"></div>
          <div class="sb-brand-text">
            <span class="sb-brand-title">Bharatiya Bazaar</span>
            <span class="sb-brand-role">${isSuperAdmin ? "Super Admin" : "Admin Staff"}</span>
          </div>
          <button class="sb-close-btn" type="button" onclick="toggleSidebar(false)">✕</button>
        </a>

        <!-- Scrollable Navigation -->
        <nav class="sb-nav">
          <a href="bb-admin.html" class="sb-item ${activeKey === 'dashboard' ? 'active' : ''}">
            <span class="sb-icon">📊</span>
            <span class="sb-label">Dashboard</span>
          </a>

          <!-- MANAGEMENT -->
          <div class="sb-group-title">MANAGEMENT</div>
          <a href="bb-admin-members.html" class="sb-item ${activeKey === 'members' ? 'active' : ''}">
            <span class="sb-icon">👥</span>
            <span class="sb-label">Member Explorer</span>
          </a>
          <a href="bb-admin-vendors.html" class="sb-item ${activeKey === 'vendors' ? 'active' : ''}">
            <span class="sb-icon">🏪</span>
            <span class="sb-label">Vendor Management</span>
          </a>
          <a href="bb-admin-kyc.html" class="sb-item ${activeKey === 'kyc' ? 'active' : ''}">
            <span class="sb-icon">🪪</span>
            <span class="sb-label">KYC Document Queue</span>
            <span class="sb-badge" id="sbKycBadge" style="display:none;">0</span>
          </a>
          <a href="bb-admin-users.html" class="sb-item ${activeKey === 'users' ? 'active' : ''}" style="${isSuperAdmin ? '' : 'display:none;'}">
            <span class="sb-icon">🛡️</span>
            <span class="sb-label">Admin Users & Roles</span>
          </a>

          <!-- FINANCE & MLM -->
          <div class="sb-group-title">FINANCE & MLM</div>
          <a href="bb-admin-reports.html" class="sb-item ${activeKey === 'reports' ? 'active' : ''}">
            <span class="sb-icon">📑</span>
            <span class="sb-label">Financial Reports</span>
          </a>
          <a href="bb-admin-withdrawals.html" class="sb-item ${activeKey === 'withdrawals' ? 'active' : ''}">
            <span class="sb-icon">⚡</span>
            <span class="sb-label">Withdrawal Queue</span>
            <span class="sb-badge warning" id="sbWithdrawalBadge" style="display:none;">0</span>
          </a>
          <a href="bb-admin-pins.html" class="sb-item ${activeKey === 'pins' ? 'active' : ''}">
            <span class="sb-icon">🔑</span>
            <span class="sb-label">Activation PINs</span>
          </a>
          <a href="bb-admin-autopool.html" class="sb-item ${activeKey === 'autopool' ? 'active' : ''}">
            <span class="sb-icon">🌊</span>
            <span class="sb-label">AutoPool Inspector</span>
          </a>
          <a href="bb-admin-setukosh.html" class="sb-item ${activeKey === 'setukosh' ? 'active' : ''}">
            <span class="sb-icon">🏛️</span>
            <span class="sb-label">Setu Kosh Pools</span>
          </a>

          <!-- SYSTEM -->
          <div class="sb-group-title">SYSTEM</div>
          <a href="bb-admin-settings.html" class="sb-item ${activeKey === 'settings' ? 'active' : ''}">
            <span class="sb-icon">⚙️</span>
            <span class="sb-label">Platform Settings</span>
          </a>
          <a href="bb-admin-audit.html" class="sb-item ${activeKey === 'audit' ? 'active' : ''}" style="${isSuperAdmin ? '' : 'display:none;'}">
            <span class="sb-icon">📜</span>
            <span class="sb-label">Audit Trail</span>
          </a>
          <a href="bb-admin-broadcast.html" class="sb-item ${activeKey === 'broadcast' ? 'active' : ''}">
            <span class="sb-icon">📢</span>
            <span class="sb-label">Broadcast & Alerts</span>
          </a>
        </nav>

        <!-- Pinned Footer -->
        <div class="sb-footer">
          <div class="sb-user-card">
            <div class="sb-avatar">${(admin.name || "A").charAt(0).toUpperCase()}</div>
            <div class="sb-user-meta">
              <div class="sb-user-name">${admin.name || "Administrator"}</div>
              <div class="sb-user-email">${admin.email || "admin@bharatiyabazaar.com"}</div>
            </div>
          </div>
          <button class="sb-logout-btn" type="button" onclick="logoutAdmin()">
            <span>🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    `;

    // Mount or replace sidebar container
    let existingSidebar = document.getElementById("adminSidebar");
    if (existingSidebar) {
      existingSidebar.outerHTML = sidebarHtml;
    } else {
      const container = document.createElement("div");
      container.innerHTML = sidebarHtml;
      document.body.insertBefore(container.firstElementChild, document.body.firstChild);
    }
  }

  // 5. Sidebar Toggle Function
  window.toggleSidebar = function (open) {
    const sidebar = document.getElementById("adminSidebar");
    const backdrop = document.getElementById("sbBackdrop");
    if (!sidebar) return;

    if (open === undefined) {
      sidebar.classList.toggle("open");
      if (backdrop) backdrop.classList.toggle("show");
    } else if (open) {
      sidebar.classList.add("open");
      if (backdrop) backdrop.classList.add("show");
    } else {
      sidebar.classList.remove("open");
      if (backdrop) backdrop.classList.remove("show");
    }
  };

  // 6. Automatic Initialization on DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    if (isLoginPage) return;

    document.body.classList.add("admin-body");

    // Detect active page key
    let pageKey = "dashboard";
    const path = window.location.pathname;

    if (path.includes("bb-admin-reports.html")) pageKey = "reports";
    else if (path.includes("bb-admin-settings.html")) pageKey = "settings";
    else if (path.includes("bb-admin-withdrawals.html")) pageKey = "withdrawals";
    else if (path.includes("bb-admin-pins.html")) pageKey = "pins";
    else if (path.includes("bb-admin-users.html")) pageKey = "users";
    else if (path.includes("bb-admin-audit.html")) pageKey = "audit";
    else if (path.includes("bb-admin-vendors.html")) pageKey = "vendors";
    else if (path.includes("bb-admin-members.html")) pageKey = "members";
    else if (path.includes("bb-admin-kyc.html")) pageKey = "kyc";
    else if (path.includes("bb-admin-autopool.html")) pageKey = "autopool";
    else if (path.includes("bb-admin-setukosh.html")) pageKey = "setukosh";
    else if (path.includes("bb-admin-broadcast.html")) pageKey = "broadcast";

    renderSidebar(pageKey);
  });
})();
