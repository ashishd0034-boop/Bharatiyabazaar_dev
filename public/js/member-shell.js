/**
 * Bharatiya Bazaar Member Shell & Identity Management
 * Single source of truth for member authentication, session hygiene, and sidebar identity rendering.
 */
(function (global) {
  const API_BASE = "http://localhost:4000/api";

  function getMemberToken() {
    return localStorage.getItem("jwt_token") || localStorage.getItem("bb_token") || "";
  }

  function getStoredLoginContext() {
    try {
      const raw = localStorage.getItem("loginContext");
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setStoredLoginContext(loginCtx) {
    if (!loginCtx) {
      localStorage.removeItem("loginContext");
    } else {
      localStorage.setItem("loginContext", JSON.stringify(loginCtx));
    }
  }

  function clearAllSessionData() {
    const keysToRemove = [
      "jwt_token",
      "bb_token",
      "member",
      "loginContext",
      "admin_token",
      "bb_admin_token",
      "bb_vendor_token"
    ];
    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }

  function logout() {
    clearAllSessionData();
    window.location.href = "/bb-register.html";
  }

  function handleLogout() {
    if (confirm("Are you sure you want to logout?")) {
      logout();
    }
  }

  /**
   * Renders the unified sidebar and topbar identity components across all member pages.
   */
  function renderIdentity(profile, loginCtx) {
    if (!profile) return;

    const name = profile.name || "Member";
    const mainCard = (profile.idCards || []).find((c) => c.type === "MAIN") || profile.idCards?.[0];
    const activeCardNumber = loginCtx?.cardNumber || loginCtx?.loginCardNumber || profile.activeCard?.cardNumber || mainCard?.cardNumber || profile.memberCode || "";
    const isSub = Boolean(loginCtx?.isSubCard || (loginCtx?.cardType && loginCtx.cardType !== "MAIN") || (profile.activeCard && profile.activeCard.type !== "MAIN"));
    const isRebirth = Boolean(loginCtx?.cardType === "REBIRTH" || (profile.activeCard && profile.activeCard.type === "REBIRTH") || (activeCardNumber && activeCardNumber.startsWith("RB")));
    const ownerCode = loginCtx?.ownerMemberCode || profile.memberCode || "";

    // 1. Sidebar Avatar
    const avatarEl = document.getElementById("memberAvatar");
    if (avatarEl) {
      avatarEl.textContent = name.charAt(0).toUpperCase();
    }

    // 2. Sidebar Member Name
    const nameEl = document.getElementById("memberName");
    if (nameEl) {
      nameEl.textContent = name;
    }

    // 3. Sidebar Member Code / Badge Block
    const codeEl = document.getElementById("memberCode");
    if (codeEl) {
      let badgeHtml = "";
      if (isRebirth) {
        badgeHtml = ` <span class="badge rebirth-exempt-badge" style="background:rgba(255,255,255,0.08); color:var(--text-muted, #94a3b8); font-size:10px; padding:2px 6px; border-radius:4px; margin-left:4px;">ACB not required</span>`;
      } else if (isSub) {
        badgeHtml = ` <span class="badge sub-owner-badge" style="font-size:10px; opacity:0.85; margin-left:4px; font-weight:normal;">(owner ${ownerCode})</span>`;
      }
      codeEl.innerHTML = `${activeCardNumber}${badgeHtml}`;
    }

    // 4. Topbar elements if present
    const topbarInfo = document.getElementById("topbarMemberInfo");
    if (topbarInfo) topbarInfo.classList.remove("hidden");

    const topbarName = document.getElementById("topbarMemberName");
    if (topbarName) topbarName.textContent = name;

    const topbarCard = document.getElementById("topbarCardNumber");
    if (topbarCard) {
      topbarCard.textContent = `${activeCardNumber}${isSub ? ` (owner ${ownerCode})` : ""}`;
    }

    const greetingEl = document.getElementById("greeting");
    if (greetingEl) {
      greetingEl.textContent = `Good morning, ${name} 🙏`;
    }

    const memberSinceEl = document.getElementById("memberSince");
    if (memberSinceEl && profile.createdAt) {
      const memberSince = new Date(profile.createdAt);
      memberSinceEl.textContent = `Member since ${memberSince.toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric"
      })} · ${activeCardNumber}${isSub ? ` (owner ${ownerCode})` : ""}`;
    }
  }

  /**
   * Initializes identity for any member page by verifying profile and authoritative loginContext.
   */
  async function initMemberIdentity(options = {}) {
    const token = getMemberToken();
    if (!token) {
      if (options.redirectOnMissing !== false) {
        logout();
      }
      return null;
    }

    let profile = options.profile || null;
    if (!profile) {
      try {
        const res = await fetch(`${API_BASE}/members/profile`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });
        if (res.status === 401) {
          logout();
          return null;
        }
        const data = await res.json();
        if (data.success && data.data) {
          profile = data.data;
        }
      } catch (err) {
        console.error("Failed to fetch member profile:", err);
      }
    }

    if (!profile) {
      return null;
    }

    // Resolve authoritative loginContext: Server profile.loginContext takes highest precedence
    const authoritativeContext = profile.loginContext || options.loginContext || getStoredLoginContext() || {
      cardNumber: profile.activeCard?.cardNumber || profile.memberCode,
      cardType: profile.activeCard?.type || "MAIN",
      isSubCard: profile.activeCard?.type ? profile.activeCard.type !== "MAIN" : false,
      ownerMemberCode: profile.memberCode
    };

    // Keep localStorage synchronized with server truth
    setStoredLoginContext(authoritativeContext);
    renderIdentity(profile, authoritativeContext);

    return {
      profile,
      loginContext: authoritativeContext,
      token
    };
  }

  /**
   * Card switch helper to propagate context to all pages.
   */
  function setLoginContext(newContext) {
    setStoredLoginContext(newContext);
  }

  /**
   * Safe asynchronous loader with complete lifecycle management.
   * Guarantees that no container is left in an indefinite "Loading..." state.
   *
   * @param {string|HTMLElement} target - Element or Element ID to manage content for.
   * @param {Function} asyncFn - Async function returning data or rendering content.
   * @param {Object} [options] - Options:
   *   @param {string|HTMLElement} [options.loaderEl] - Optional separate loader element/ID to hide in finally.
   *   @param {string|HTMLElement} [options.contentEl] - Optional separate content element/ID to unhide.
   *   @param {string} [options.emptyText] - Default empty state message.
   *   @param {string} [options.emptyHtml] - Custom empty state HTML.
   *   @param {string} [options.errorText] - Custom error message prefix.
   *   @param {number} [options.colspan] - Table colspan if target is a tbody.
   */
  async function safeLoad(target, asyncFn, options = {}) {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    const loader = typeof options.loaderEl === "string" ? document.getElementById(options.loaderEl) : options.loaderEl;
    const content = typeof options.contentEl === "string" ? document.getElementById(options.contentEl) : options.contentEl;

    try {
      const result = await asyncFn();
      if (content) content.classList.remove("hidden");

      if (el && result !== undefined) {
        if (Array.isArray(result) && result.length === 0) {
          const colspan = options.colspan ? ` colspan="${options.colspan}"` : "";
          const isTable = el.tagName === "TBODY" || el.tagName === "TABLE";
          const emptyMsg = options.emptyText || "No records found.";
          const emptyHtml = options.emptyHtml || (isTable
            ? `<tr><td${colspan} style="text-align:center; padding:20px; color:var(--muted, #64748b);">${emptyMsg}</td></tr>`
            : `<div style="text-align:center; padding:20px; color:var(--muted, #64748b);">${emptyMsg}</div>`);
          el.innerHTML = emptyHtml;
        }
      }
      return result;
    } catch (err) {
      console.error("[safeLoad error]", err);
      if (content) content.classList.remove("hidden");
      if (el) {
        const colspan = options.colspan ? ` colspan="${options.colspan}"` : "";
        const isTable = el.tagName === "TBODY" || el.tagName === "TABLE";
        const errMsg = options.errorText || `Failed to load data: ${err.message || "Please refresh."}`;
        const errorHtml = isTable
          ? `<tr><td${colspan} style="text-align:center; padding:20px; color:var(--danger, #dc2626);">⚠️ ${errMsg}</td></tr>`
          : `<div style="text-align:center; padding:20px; color:var(--danger, #dc2626);">⚠️ ${errMsg}</div>`;
        el.innerHTML = errorHtml;
      }
      return null;
    } finally {
      if (loader) {
        loader.classList.add("hidden");
        loader.style.display = "none";
      }
    }
  }

  const MemberShell = {
    API_BASE,
    getMemberToken,
    getStoredLoginContext,
    setStoredLoginContext,
    setLoginContext,
    clearAllSessionData,
    logout,
    handleLogout,
    renderIdentity,
    initMemberIdentity,
    safeLoad
  };

  global.MemberShell = MemberShell;
  global.getMemberToken = getMemberToken;
  global.clearAllSessionData = clearAllSessionData;
  global.logout = logout;
  global.handleLogout = handleLogout;
  global.initMemberIdentity = initMemberIdentity;
  global.setLoginContext = setLoginContext;
  global.safeLoad = safeLoad;
})(typeof window !== "undefined" ? window : global);
