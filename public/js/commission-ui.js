/**
 * Bharatiya Bazaar — Unified Commission Presentation Engine (CommissionUI)
 * Single Source of Truth for Commission Badges, Labels, Subtexts, and Rows
 *
 * Enforces strict Presentation-Only consistency across Dashboard & Commissions History.
 */
(function (global) {
  'use strict';

  function formatINR(paise) {
    const num = (Number(paise) || 0) / 100;
    return 'Rs.' + num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  const STATUS_CONFIG = {
    WITHDRAWABLE: {
      label: 'WITHDRAWABLE',
      badgeClass: 'success',
      getSubtext: () => null
    },
    CONFIRMED: {
      label: 'WITHDRAWABLE',
      badgeClass: 'success',
      getSubtext: () => null
    },
    PENDING_7_DAY: {
      label: 'PENDING (7-DAY)',
      badgeClass: 'pending',
      getSubtext: (entry) => {
        if (!entry.createdAt) return '7-day holding period';
        const createdMs = new Date(entry.createdAt).getTime();
        const releaseDate = new Date(createdMs + 7 * 24 * 60 * 60 * 1000);
        const nowMs = Date.now();
        const daysRemaining = Math.max(0, Math.ceil((releaseDate.getTime() - nowMs) / (24 * 60 * 60 * 1000)));

        const isRebirth = entry.cardType === 'REBIRTH' || (entry.cardNumber && entry.cardNumber.startsWith('RB'));
        const acbTag = isRebirth
          ? 'ACB not required'
          : (entry.cardAcbStatus ? 'ACB ✓' : 'Awaiting ACB');

        return `Releases in ${daysRemaining}d (${formatDate(releaseDate)}) · ${acbTag}`;
      }
    },
    LOCKED_ACB: {
      label: 'LOCKED (ACB)',
      badgeClass: 'locked',
      getSubtext: () => 'Awaiting 1L + 1R referral on this ID'
    },
    PAY_ONCE_BLOCKED: {
      label: 'PAY-ONCE BLOCKED',
      badgeClass: 'blocked',
      getSubtext: (entry) => `Already rewarded for Level ${entry.level || 1}`
    },
    PENDING_SETTLEMENT: {
      label: 'PENDING (SETTLEMENT)',
      badgeClass: 'pending',
      getSubtext: () => 'Releases upon vendor weekly settlement'
    },
    PIN_GATE_INACTIVE: {
      label: 'PIN GATE INACTIVE',
      badgeClass: 'locked',
      getSubtext: () => 'Activation threshold required'
    },
    PENDING: {
      label: 'PENDING',
      badgeClass: 'pending',
      getSubtext: () => 'Processing'
    },
    EXPIRED: {
      label: 'EXPIRED',
      badgeClass: 'muted',
      getSubtext: () => 'Expired'
    },
    CANCELLED: {
      label: 'CANCELLED',
      badgeClass: 'muted',
      getSubtext: () => 'Cancelled'
    }
  };

  function getStatusMeta(status) {
    const key = (status || '').toUpperCase();
    return STATUS_CONFIG[key] || {
      label: status || 'UNKNOWN',
      badgeClass: 'pending',
      getSubtext: () => null
    };
  }

  function renderCardBadge(entry) {
    if (!entry || !entry.cardNumber) return '—';
    const cardType = entry.cardType || 'MAIN';
    return `<strong>${entry.cardNumber}</strong> <span class="card-type-tag" style="font-size:11px; opacity:0.75; font-weight:normal;">(${cardType})</span>`;
  }

  function renderReleaseSubtext(entry) {
    if (!entry) return '';
    const meta = getStatusMeta(entry.status);
    const subtext = meta.getSubtext ? meta.getSubtext(entry) : null;
    if (!subtext) return '';
    return `<div class="status-subtext" style="font-size:10.5px; opacity:0.8; margin-top:2px; line-height:1.2;">${subtext}</div>`;
  }

  function renderStatusBadge(entry) {
    if (!entry) return '—';
    const meta = getStatusMeta(entry.status);
    const subtextHtml = renderReleaseSubtext(entry);
    return `<span class="badge ${meta.badgeClass}">${meta.label}</span>${subtextHtml}`;
  }

  function renderCommissionRow(entry, opts = {}) {
    if (!entry) return '';
    const dateFormatted = formatDate(entry.createdAt);
    const cardBadge = renderCardBadge(entry);
    const stream = entry.stream || 'COMMISSION';
    const levelText = `Level ${entry.level !== undefined && entry.level !== null ? entry.level : 1}`;
    const amountFormatted = `+${formatINR(entry.amountPaise)}`;
    const statusCell = renderStatusBadge(entry);

    return `
      <tr data-stream="${stream}" data-status="${entry.status || ''}">
        <td>${dateFormatted}</td>
        <td>${cardBadge}</td>
        <td>${stream}</td>
        <td>${levelText}</td>
        <td style="font-weight:600; color:var(--text, #17233a);">${amountFormatted}</td>
        <td>${statusCell}</td>
      </tr>
    `.trim();
  }

  function renderCommissionsTable(entries, tbodyElementOrId, opts = {}) {
    const tbody = typeof tbodyElementOrId === 'string'
      ? document.getElementById(tbodyElementOrId)
      : tbodyElementOrId;

    if (!tbody) return;

    if (!entries || entries.length === 0) {
      const emptyMsg = opts.emptyMessage || 'No commissions yet. Start referring friends to earn!';
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted, #64748b); padding:32px 16px;">${emptyMsg}</td></tr>`;
      return;
    }

    const limit = opts.limit ? Math.min(entries.length, opts.limit) : entries.length;
    const slice = entries.slice(0, limit);

    tbody.innerHTML = slice.map(e => renderCommissionRow(e, opts)).join('');
  }

  const CommissionUI = {
    formatINR,
    formatDate,
    STATUS_CONFIG,
    getStatusMeta,
    renderCardBadge,
    renderReleaseSubtext,
    renderStatusBadge,
    renderCommissionRow,
    renderCommissionsTable
  };

  // Attach to window / exports
  global.CommissionUI = CommissionUI;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CommissionUI;
  }
})(typeof window !== 'undefined' ? window : global);
