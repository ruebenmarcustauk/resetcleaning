(function () {
  'use strict';

  var API = '/.netlify/functions';
  var SAVE_KEY = 'rc-booking-v1';
  var root = document.getElementById('booking');
  if (!root) return;

  var STEPS = ['Your clean', 'Extras', 'Date & time', 'Your details'];

  var ICONS = {
    regular: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    deep: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    bond: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/>',
    oven_interior: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6.5" y="9" width="11" height="8.5" rx="1"/><path d="M7 6h.01M10 6h.01M13 6h4"/>',
    fridge_interior: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M5 10h14M8 6v2M8 13v3"/>',
    inside_cupboards: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M10 11v2M14 11v2"/>',
    blinds: '<path d="M4 3h16M5 3v14h14V3M5 7h14M5 11h14M5 15h14M12 17v4"/>',
    walls: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.6h18M9 4v5.3M15 9.3v5.3M9 14.6V20"/>',
    outside_windows: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 12h16"/>',
    laundry: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7.5 6h.01M10.5 6h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function icon(name, w) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.5) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + (Number.isInteger(n) ? n : n.toFixed(2)); }
  function hrs(h) { return h + (h === 1 ? ' hr' : ' hrs'); }
  function isPhone() { return window.matchMedia('(max-width: 900px)').matches; }
  // Meta Pixel standard events (no-op if the pixel hasn't loaded).
  function metaTrack(name, params, eventId) {
    if (typeof window.fbq !== 'function') return;
    if (eventId) window.fbq('track', name, params || {}, { eventID: eventId });
    else window.fbq('track', name, params || {});
  }
  function metaParams() {
    var s = P.services[state.service], q = quote();
    var p = { content_name: s.label, content_category: 'Cleaning', currency: 'AUD', num_items: 1 };
    if (q && q.total) p.value = q.total;
    return p;
  }

  var P = null; // pricing.json
  var TZ = 'Australia/Brisbane';
  var fmtTime, fmtDay, fmtDayLong, fmtWeekday, fmtMonthShort;

  var state = {
    step: 0,
    service: null,
    bedrooms: 2,
    bathrooms: 1,
    frequency: 'fortnightly',
    extras: [],
    day: null,
    slot: null,
    access: null,
    addr: null,
    contact: {},
    showNotes: false,
    submitting: false
  };
  var slots = { status: 'idle', days: {}, error: null }; // availability for the next few months

  // ── saved progress (so people can leave and come back) ──
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        at: Date.now(),
        step: Math.min(state.step, 3),
        service: state.service, bedrooms: state.bedrooms, bathrooms: state.bathrooms,
        frequency: state.frequency, extras: state.extras, access: state.access,
        addr: state.addr, contact: state.contact, showNotes: state.showNotes
      }));
    } catch (e) { /* storage unavailable */ }
  }
  function restore() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s || Date.now() - s.at > 7 * 864e5 || !P.services[s.service]) return;
      ['service', 'bedrooms', 'bathrooms', 'frequency', 'extras', 'access', 'addr', 'contact', 'showNotes'].forEach(function (k) {
        if (s[k] != null) state[k] = s[k];
      });
      // Times go stale, so come back no further than the date step.
      state.step = Math.min(s.step || 0, 2);
    } catch (e) { /* ignore */ }
  }
  function clearSaved() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

  // ── pricing ──
  function quote() {
    var s = P.services[state.service];
    if (!s) return null;
    var b = state.bedrooms;
    var q;
    if (b <= 5) q = { base: s.prices[b], baseHours: s.includedHours ? s.includedHours[b] : null, quote: false };
    else if (s.over5.type === 'perBedroom') q = { base: s.prices['5'] + (b - 5) * s.over5.amount, baseHours: null, quote: false };
    else q = { base: null, baseHours: null, quote: true };
    var n = chosenExtras().length;
    q.extrasTotal = n * extraPrice();
    q.total = q.quote ? null : q.base + q.extrasTotal;
    q.hours = q.baseHours ? q.baseHours + n * (P.extraHoursEach || 1) : null;
    return q;
  }
  // Each extra is charged as one hour at the clean type's extra-time rate.
  function extraPrice() {
    var s = P.services[state.service];
    return s ? s.extraPerHour * (P.extraHoursEach || 1) : 0;
  }
  function availableExtras() {
    return P.extras.filter(function (x) { return x.includedIn.indexOf(state.service) === -1; });
  }
  function chosenExtras() {
    return availableExtras().filter(function (x) { return state.extras.indexOf(x.id) !== -1; });
  }

  // ── dates (Gold Coast time, UTC+10 all year) ──
  function todayKey() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function shiftMonth(key, d) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7) + d;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y + '-' + String(m).padStart(2, '0');
  }
  function dayDate(key) { return new Date(key + 'T12:00:00+10:00'); }

  // ── layout ──
  function shell() {
    root.innerHTML =
      '<div class="bk-main">' +
        '<div class="bk-top">' +
          '<button type="button" class="bk-top-back" aria-label="Back">' + icon('left', 2) + '</button>' +
          '<div class="bk-top-text"><span class="bk-top-count"></span><span class="bk-top-name"></span></div>' +
        '</div>' +
        '<div class="bk-progress" role="list">' + STEPS.map(function (label, i) {
          return '<div class="bk-progress-step" role="listitem" data-i="' + i + '"><div class="bk-progress-bar"><span></span></div>' +
            '<p class="bk-progress-label">' + label + '</p></div>';
        }).join('') + '</div>' +
        '<section class="bk-step" data-step="0"></section>' +
        '<section class="bk-step" data-step="1"></section>' +
        '<section class="bk-step" data-step="2"></section>' +
        '<section class="bk-step" data-step="3"></section>' +
        '<section class="bk-step" data-step="4"></section>' +
        '<p class="bk-error" role="alert" aria-live="assertive"></p>' +
        '<div class="bk-nav"><button type="button" class="bk-back">Back</button>' +
          '<button type="button" class="bk-next">Continue</button></div>' +
      '</div>' +
      '<div class="bk-sheet-backdrop" hidden></div>' +
      '<aside class="bk-summary" aria-label="Booking summary"><div class="bk-sum-card"></div></aside>' +
      '<div class="bk-bar">' +
        '<button type="button" class="bk-bar-price" aria-label="Show booking summary"></button>' +
        '<button type="button" class="bk-next">Continue</button>' +
      '</div>';

    root.querySelectorAll('.bk-next').forEach(function (b) { b.addEventListener('click', next); });
    root.querySelectorAll('.bk-back, .bk-top-back').forEach(function (b) { b.addEventListener('click', back); });
    $('.bk-bar-price').addEventListener('click', function () { toggleSheet(true); });
    $('.bk-sheet-backdrop').addEventListener('click', function () { toggleSheet(false); });
  }

  function $(sel) { return root.querySelector(sel); }
  function stepEl(i) { return root.querySelector('.bk-step[data-step="' + i + '"]'); }
  var errTimer = null;
  function setError(msg) {
    var el = $('.bk-error');
    el.textContent = msg || '';
    clearTimeout(errTimer);
    if (msg && isPhone()) errTimer = setTimeout(function () { el.textContent = ''; }, 5000);
  }
  function toggleSheet(open) {
    root.classList.toggle('sheet-open', open);
    $('.bk-sheet-backdrop').hidden = !open;
    document.documentElement.classList.toggle('bk-no-scroll', open);
  }

  // ── step 0: clean type & size ──
  function renderStep0() {
    var s = state.service ? P.services[state.service] : null;
    var html =
      '<h2 class="bk-h">What kind of clean?</h2>' +
      '<p class="bk-sub">Upfront prices. No payment today.</p>' +
      '<div class="bk-group"><div class="bk-services" role="radiogroup" aria-label="Clean type">' +
      Object.keys(P.services).map(function (id) {
        var sv = P.services[id];
        return '<button type="button" class="bk-card" role="radio" data-service="' + id + '" aria-checked="' + (state.service === id) + '">' +
          '<span class="bk-card-icon">' + icon(id, 1.4) + '</span>' +
          '<span class="bk-card-body"><span class="bk-card-title">' + esc(sv.label) + '</span>' +
          '<span class="bk-card-text">' + esc(sv.tagline) + '</span></span>' +
          '<span class="bk-card-price">from <strong>' + money(sv.prices['1']) + '</strong></span></button>';
      }).join('') + '</div></div>';

    if (s) {
      var q = quote();
      html += '<div class="bk-group" id="bk-home"><p class="bk-group-title">Your home</p>' +
        counter('bedrooms', 'Bedrooms', state.bedrooms, 1, P.maxBedrooms,
          q.quote ? 'Homes over 5 bedrooms are quoted individually' : (q.baseHours ? 'Includes up to ' + hrs(q.baseHours) : '')) +
        counter('bathrooms', 'Bathrooms', state.bathrooms, 1, 6, "Doesn't change the price") +
        '</div>';

      if (s.frequencies.length > 1) {
        html += '<div class="bk-group"><p class="bk-group-title">How often?</p><div class="bk-chips bk-chips-4" role="radiogroup" aria-label="Frequency">' +
          s.frequencies.map(function (f) {
            return '<button type="button" class="bk-chip" role="radio" data-freq="' + f + '" aria-checked="' + (state.frequency === f) + '">' + esc(P.frequencyLabels[f]) + '</button>';
          }).join('') + '</div><p class="bk-hint">Same price whichever you choose.</p></div>';
      }

      html += '<div class="bk-callout">' + icon('info') + '<span>Our prices cover the typical time for a home your size. ' +
        "If yours needs longer, we'll ask before doing any extra work (" + money(s.extraPerHour) + '/hr).</span></div>';
    }
    stepEl(0).innerHTML = html;

    stepEl(0).querySelectorAll('[data-service]').forEach(function (b) {
      b.addEventListener('click', function () {
        var first = !state.service;
        state.service = b.dataset.service;
        var sv = P.services[state.service];
        if (sv.frequencies.indexOf(state.frequency) === -1) state.frequency = sv.frequencies[0];
        if (state.service === 'regular' && state.frequency === 'one_off') state.frequency = 'fortnightly';
        state.extras = state.extras.filter(function (id) {
          return availableExtras().some(function (x) { return x.id === id; });
        });
        setError('');
        renderStep0(); renderStep1(); renderSummary(); save();
        // First pick on a phone: bring the next question into view.
        if (first && isPhone()) {
          var home = document.getElementById('bk-home');
          if (home) setTimeout(function () { scrollToEl(home, 130); }, 60);
        }
      });
    });
    stepEl(0).querySelectorAll('[data-freq]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.frequency = b.dataset.freq;
        stepEl(0).querySelectorAll('[data-freq]').forEach(function (o) { o.setAttribute('aria-checked', o === b); });
        renderSummary(); save();
      });
    });
    bindCounters();
  }
  function bindCounters() {
    // Bind +/- buttons once each (they're replaced in place on every tap).
    stepEl(0).querySelectorAll('[data-count]:not([data-bound])').forEach(function (b) {
      b.setAttribute('data-bound', '1');
      b.addEventListener('click', function () {
        var key = b.dataset.count, d = +b.dataset.d;
        var max = key === 'bedrooms' ? P.maxBedrooms : 6;
        state[key] = Math.min(max, Math.max(1, state[key] + d));
        b.closest('.bk-counter').outerHTML = counterFor(key);
        bindCounters();
        renderSummary(); save();
      });
    });
  }
  function counterFor(key) {
    if (key === 'bathrooms') return counter('bathrooms', 'Bathrooms', state.bathrooms, 1, 6, "Doesn't change the price");
    var q = quote();
    return counter('bedrooms', 'Bedrooms', state.bedrooms, 1, P.maxBedrooms,
      q.quote ? 'Homes over 5 bedrooms are quoted individually' : (q.baseHours ? 'Includes up to ' + hrs(q.baseHours) : ''));
  }
  function counter(key, label, val, min, max, help) {
    var raw = state[key];
    return '<div class="bk-counter"><div><p class="bk-counter-label">' + label + '</p>' +
      (help ? '<p class="bk-counter-help">' + esc(help) + '</p>' : '') + '</div>' +
      '<div class="bk-counter-ctrl">' +
      '<button type="button" class="bk-round" data-count="' + key + '" data-d="-1" aria-label="Fewer ' + label.toLowerCase() + '"' + (raw <= min ? ' disabled' : '') + '>&minus;</button>' +
      '<span class="bk-counter-val" aria-live="polite">' + val + '</span>' +
      '<button type="button" class="bk-round" data-count="' + key + '" data-d="1" aria-label="More ' + label.toLowerCase() + '"' + (raw >= max ? ' disabled' : '') + '>+</button>' +
      '</div></div>';
  }

  // ── step 1: extras ──
  function renderStep1() {
    if (!state.service) return;
    var s = P.services[state.service];
    var included = P.extras.filter(function (x) { return x.includedIn.indexOf(state.service) !== -1; });
    var html = '<h2 class="bk-h">Add any extras?</h2>' +
      '<p class="bk-sub">' + money(extraPrice()) + ' each' +
        (s.includedHours ? ', and we add an hour to your booking for each one' : '') + '. Optional.</p>' +
      '<div class="bk-group"><div class="bk-extras">' +
      availableExtras().map(function (x) {
        var on = state.extras.indexOf(x.id) !== -1;
        return '<button type="button" class="bk-extra" data-extra="' + x.id + '" aria-pressed="' + on + '">' +
          '<span class="bk-extra-icon">' + icon(x.id) + '</span>' +
          '<span class="bk-extra-body"><span class="bk-extra-name">' + esc(x.label) + '</span>' +
          '<span class="bk-extra-meta">+' + money(extraPrice()) + '</span></span>' +
          '<span class="bk-extra-check">' + icon('check', 3) + '</span></button>';
      }).join('') + '</div>' +
      (included.length ? '<p class="bk-included"><span class="bk-badge">Included</span> ' +
        esc(included.map(function (x) { return x.label; }).join(', ')) + ' — already part of your ' + esc(s.label.toLowerCase()) + '.</p>' : '') +
      '</div>';
    stepEl(1).innerHTML = html;
    stepEl(1).querySelectorAll('[data-extra]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.extra, i = state.extras.indexOf(id);
        if (i === -1) state.extras.push(id); else state.extras.splice(i, 1);
        b.setAttribute('aria-pressed', i === -1);
        renderSummary(); renderNav(); save();
      });
    });
  }

  // ── step 2: date & time ──
  // Load the next three months at once so the date strip is complete.
  function loadSlots(force) {
    if (!force && (slots.status === 'loading' || slots.status === 'ready')) return;
    slots = { status: 'loading', days: {}, error: null };
    var cur = todayKey().slice(0, 7);
    var months = [cur, shiftMonth(cur, 1), shiftMonth(cur, 2)];
    Promise.all(months.map(function (m) {
      return fetch(API + '/booking-slots?month=' + m)
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Error'); return j.days || {}; }); });
    })).then(function (all) {
      var days = {};
      all.forEach(function (d) { Object.keys(d).forEach(function (k) { days[k] = d[k]; }); });
      slots = { status: 'ready', days: days, error: null };
    }).catch(function (e) {
      slots = { status: 'error', days: {}, error: e.message || "Couldn't load availability." };
    }).then(function () {
      if (state.step === 2) renderStep2();
    });
  }

  function renderStep2() {
    loadSlots();
    var html = '<h2 class="bk-h">When suits you?</h2>' +
      '<p class="bk-sub">Pick a day, then a start time. Gold Coast time.</p>';

    if (slots.status === 'loading' || slots.status === 'idle') {
      html += '<div class="bk-dates bk-dates-loading">' + new Array(6).join('<span class="bk-date bk-skel"></span>') + '</div>' +
        '<div class="bk-loading"><span class="bk-spinner"></span>Checking availability…</div>';
      stepEl(2).innerHTML = html;
      return;
    }
    if (slots.status === 'error') {
      html += '<div class="bk-empty">' + esc(slots.error) + '<br><button type="button" class="bk-link" data-retry>Try again</button>' +
        ' or call <a href="tel:+61494427135">0494 427 135</a></div>';
      stepEl(2).innerHTML = html;
      stepEl(2).querySelector('[data-retry]').addEventListener('click', function () { loadSlots(true); renderStep2(); });
      return;
    }

    var days = Object.keys(slots.days).sort();
    if (!days.length) {
      html += '<div class="bk-empty">We’re fully booked online for now. Call <a href="tel:+61494427135">0494 427 135</a> and we’ll find you a time.</div>';
      stepEl(2).innerHTML = html;
      return;
    }
    if (!state.day || !slots.days[state.day]) { state.day = days[0]; state.slot = null; }
    if (state.slot && slots.days[state.day].indexOf(state.slot) === -1) state.slot = null;

    var lastMonth = '';
    html += '<div class="bk-dates-wrap">' +
      '<button type="button" class="bk-dates-arrow prev" aria-label="Earlier dates">' + icon('left', 2) + '</button>' +
      '<div class="bk-dates" role="listbox" aria-label="Available days">' +
      days.map(function (k) {
        var d = dayDate(k), mon = fmtMonthShort.format(d);
        var showMon = mon !== lastMonth; lastMonth = mon;
        return '<button type="button" class="bk-date" role="option" data-day="' + k + '" aria-selected="' + (state.day === k) + '" aria-label="' + fmtDayLong.format(d) + '">' +
          '<span class="bk-date-dow">' + (k === todayKey() ? 'Today' : fmtWeekday.format(d)) + '</span>' +
          '<span class="bk-date-num">' + +k.slice(8) + '</span>' +
          '<span class="bk-date-mon">' + (showMon || state.day === k ? mon : '&nbsp;') + '</span></button>';
      }).join('') + '</div>' +
      '<button type="button" class="bk-dates-arrow next" aria-label="Later dates">' + icon('right', 2) + '</button></div>';

    html += '<div class="bk-times"><p class="bk-times-title">' + fmtDayLong.format(dayDate(state.day)) + '</p>' +
      '<div class="bk-times-grid" role="listbox" aria-label="Start times">' +
      slots.days[state.day].map(function (t) {
        return '<button type="button" class="bk-time" role="option" data-slot="' + esc(t) + '" aria-selected="' + (state.slot === t) + '">' + fmtTime.format(new Date(t)) + '</button>';
      }).join('') + '</div></div>';
    stepEl(2).innerHTML = html;

    var strip = stepEl(2).querySelector('.bk-dates');
    var sel = strip.querySelector('[aria-selected="true"]');
    if (sel) strip.scrollLeft = Math.max(0, sel.offsetLeft - strip.offsetLeft - 8);
    stepEl(2).querySelectorAll('.bk-dates-arrow').forEach(function (a) {
      a.addEventListener('click', function () {
        strip.scrollBy({ left: (a.classList.contains('next') ? 1 : -1) * strip.clientWidth * 0.8, behavior: 'smooth' });
      });
    });
    strip.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (state.day === b.dataset.day) return;
        var keep = strip.scrollLeft;
        state.day = b.dataset.day; state.slot = null; setError('');
        renderStep2(); renderSummary(); renderNav();
        stepEl(2).querySelector('.bk-dates').scrollLeft = keep;
      });
    });
    stepEl(2).querySelectorAll('[data-slot]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.slot = b.dataset.slot; setError('');
        stepEl(2).querySelectorAll('[data-slot]').forEach(function (o) { o.setAttribute('aria-selected', o === b); });
        renderSummary(); renderNav();
      });
    });
  }

  // ── step 3: details ──
  function renderStep3() {
    var s = P.services[state.service], q = quote();
    var recap = '<div class="bk-recap">' +
      '<div class="bk-recap-row"><span><strong>' + esc(s.label) + '</strong> · ' + state.bedrooms + ' bed' +
        (chosenExtras().length ? ' + ' + chosenExtras().length + ' extra' + (chosenExtras().length > 1 ? 's' : '') : '') + '</span>' +
        '<button type="button" class="bk-link" data-edit="0">Edit</button></div>' +
      '<div class="bk-recap-row"><span>' + fmtDay.format(new Date(state.slot)) + ' at ' + fmtTime.format(new Date(state.slot)) + '</span>' +
        '<button type="button" class="bk-link" data-edit="2">Change</button></div>' +
      '<div class="bk-recap-row bk-recap-total"><span>Total</span><strong>' + (q.quote ? 'Quoted' : money(q.total)) + '</strong></div>' +
      '</div>';

    if (stepEl(3).querySelector('form')) {
      // Keep what they've typed; just refresh the recap.
      stepEl(3).querySelector('.bk-recap').outerHTML = recap;
      bindRecap();
      return;
    }
    var c = state.contact || {};
    var accessHelp = { lockbox: 'Where is the lockbox, and the code?', key: 'Where will the key be?', concierge: 'Building name or concierge details', home: 'Anything we should know to get in?' };
    stepEl(3).innerHTML =
      '<h2 class="bk-h">Last step: your details</h2>' +
      '<p class="bk-sub">No payment today. We’ll text you a payment link after your clean.</p>' +
      recap +
      '<form class="bk-form" novalidate autocomplete="on">' +
      '<div class="bk-group"><div class="bk-fields">' +
      field('firstName', 'First name', 'text', 'given-name', false, 'autocapitalize="words" enterkeyhint="next"', c.firstName) +
      field('lastName', 'Last name', 'text', 'family-name', false, 'autocapitalize="words" enterkeyhint="next"', c.lastName) +
      field('phone', 'Mobile', 'tel', 'tel', true, 'inputmode="tel" enterkeyhint="next"', c.phone) +
      field('email', 'Email', 'email', 'email', true, 'inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"', c.email) +
      '<div class="bk-field full bk-addr"><label for="bk-street">Address</label>' +
      '<input id="bk-street" name="street" type="text" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" ' +
      'placeholder="Start typing your address" value="' + esc(c.street || '') + '" required ' +
      'role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bk-addr-list">' +
      '<ul class="bk-addr-list" id="bk-addr-list" role="listbox" hidden></ul></div>' +
      '</div></div>' +
      '<div class="bk-group"><p class="bk-group-title">How will we get in?</p><div class="bk-chips bk-chips-2" role="radiogroup" aria-label="Access">' +
      P.accessOptions.map(function (a) {
        return '<button type="button" class="bk-chip" role="radio" data-access="' + a.id + '" aria-checked="' + (state.access === a.id) + '">' + esc(a.label) + '</button>';
      }).join('') + '</div>' +
      '<div class="bk-field full bk-access-details"' + (state.access ? '' : ' hidden') + '><label for="bk-accessDetails">Details (optional)</label>' +
      '<input id="bk-accessDetails" name="accessDetails" type="text" enterkeyhint="done" placeholder="' + esc(accessHelp[state.access] || '') + '" value="' + esc(c.accessDetails || '') + '"></div>' +
      '</div>' +
      '<div class="bk-group bk-notes"' + (state.showNotes || c.notes ? '' : ' hidden') + '><div class="bk-field full"><label for="bk-notes">Anything else? (optional)</label>' +
      '<textarea id="bk-notes" name="notes" rows="3" placeholder="Pets, parking, areas to focus on…">' + esc(c.notes || '') + '</textarea></div></div>' +
      '<button type="button" class="bk-add-note"' + (state.showNotes || c.notes ? ' hidden' : '') + '>' + icon('plus', 2) + 'Add a note (pets, parking…)</button>' +
      '<div class="bk-hp" aria-hidden="true"><label>Company<input name="company" tabindex="-1" autocomplete="off"></label></div>' +
      '<p class="bk-fineprint">You’ll never be charged for extra time you haven’t approved.</p>' +
      '</form>';

    bindRecap();
    stepEl(3).querySelectorAll('[data-access]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.access = b.dataset.access;
        setError('');
        stepEl(3).querySelectorAll('[data-access]').forEach(function (o) { o.setAttribute('aria-checked', o === b); });
        var det = stepEl(3).querySelector('.bk-access-details');
        det.hidden = false;
        det.querySelector('input').placeholder = accessHelp[state.access] || '';
        save();
      });
    });
    stepEl(3).querySelector('.bk-add-note').addEventListener('click', function () {
      state.showNotes = true;
      this.hidden = true;
      var n = stepEl(3).querySelector('.bk-notes');
      n.hidden = false;
      n.querySelector('textarea').focus();
    });
    stepEl(3).querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); next(); });
    setupAddress(stepEl(3).querySelector('#bk-street'), stepEl(3).querySelector('#bk-addr-list'));
    stepEl(3).querySelectorAll('input, textarea').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var f = inp.closest('.bk-field');
        if (f) f.classList.remove('invalid');
        setError('');
        state.contact = formValues();
        save();
      });
    });
    // "Next" on the iPhone keyboard moves to the next box.
    ['firstName', 'lastName', 'phone', 'email'].forEach(function (k, i, arr) {
      var el = stepEl(3).querySelector('#bk-' + k);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var nextId = arr[i + 1] || 'street';
          stepEl(3).querySelector('#bk-' + nextId).focus();
        }
      });
    });
  }
  function bindRecap() {
    stepEl(3).querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { go(+b.dataset.edit); });
    });
  }

  // ── address autocomplete (Photon / OpenStreetMap, Gold Coast area) ──
  var ADDR_API = 'https://photon.komoot.io/api/';
  var ADDR_BBOX = '152.9,-28.3,153.6,-27.6';
  function setupAddress(input, list) {
    var timer = null, items = [], active = -1, pending = 0;
    var cache = {};   // query -> Promise of features
    var pool = [];    // recent result sets, re-filtered on every keystroke

    function parse(text) {
      // Keep the number they typed (e.g. 12, 12A, 3/7, "Unit 4 22") and look up the street.
      var m = /^\s*(?:(?:unit|u|apt|apartment)\s*(\d+[a-z]?)\s*[,\/]?\s+)?(\d+[a-z]?(?:\s*[\/-]\s*\d+[a-z]?)?)\s+(.+)$/i.exec(text);
      var main = m ? m[2].replace(/\s+/g, '') : '';
      var query = (m ? m[3] : text).trim();
      return {
        number: m ? (m[1] ? m[1] + '/' : '') + main : '',
        // For "3/7" (unit 3, number 7) or "19-21" look up the street number only.
        lookupNum: /\//.test(main) ? main.split('/').pop() : main.split('-')[0],
        query: query,
        firstWord: (query.match(/[a-z]+/i) || [''])[0].toLowerCase()
      };
    }
    function close() {
      list.hidden = true; list.innerHTML = ''; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false');
    }
    function highlight(i) {
      active = i;
      list.querySelectorAll('[role="option"]').forEach(function (li, j) { li.setAttribute('aria-selected', j === i); });
    }
    function pick(i) {
      var it = items[i];
      if (!it) return;
      state.addr = it;
      input.value = it.street + ', ' + it.suburb + ' ' + it.state + (it.postcode ? ' ' + it.postcode : '');
      input.closest('.bk-field').classList.remove('invalid');
      state.contact = formValues();
      save();
      close();
      if (!it.hasNumber) {
        // Street only: put the cursor at the start so they can add their number.
        input.focus(); input.setSelectionRange(0, 0);
        setError('Add your street number at the start.');
      } else {
        input.blur();
      }
    }
    // Build suggestions for what's in the box right now from every recent result.
    function refresh() {
      if (document.activeElement !== input) return;
      var q = parse(input.value);
      if (q.query.replace(/[^a-z]/gi, '').length < 3) { close(); return; }
      var seen = {}, out = [];
      pool.forEach(function (features) {
        features.forEach(function (f) {
          var p = f.properties || {};
          var streetName = p.street || p.name;
          var suburb = p.district || p.locality || p.city;
          if (!streetName || !suburb || p.state !== 'Queensland' && p.state !== 'New South Wales') return;
          // The street name must have a word starting with what they typed.
          if (!streetName.toLowerCase().split(/\s+/).some(function (w) { return w.indexOf(q.firstWord) === 0; })) return;
          var num = q.number || p.housenumber || '';
          var it = { street: (num ? num + ' ' : '') + streetName, suburb: suburb, state: p.state === 'New South Wales' ? 'NSW' : 'QLD', postcode: p.postcode || '', hasNumber: !!num };
          var k = (it.street + '|' + it.suburb).toLowerCase();
          if (seen[k]) return;
          seen[k] = true;
          // Exact house matches first.
          it.rank = p.housenumber && p.housenumber === q.lookupNum ? 0 : 1;
          out.push(it);
        });
      });
      items = out.sort(function (x, y) { return x.rank - y.rank; }).slice(0, 5);
      active = -1;
      if (!items.length && !pending) { close(); return; }
      list.innerHTML = items.length ? items.map(function (it, i) {
        return '<li role="option" id="bk-addr-' + i + '" data-i="' + i + '" aria-selected="false">' +
          '<span class="bk-addr-main">' + esc(it.street) + '</span>' +
          '<span class="bk-addr-sub">' + esc(it.suburb) + ' ' + it.state + ' ' + esc(it.postcode) + '</span></li>';
      }).join('') + '<li class="bk-addr-credit" aria-hidden="true">Not listed? Just type your full address.</li>'
        : '<li class="bk-addr-credit bk-addr-loading" aria-hidden="true"><span class="bk-spinner"></span>Searching…</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      list.querySelectorAll('[role="option"]').forEach(function (li) {
        li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(+li.dataset.i); });
      });
    }
    function lookup(q) {
      var key = q.toLowerCase();
      if (!cache[key]) {
        cache[key] = fetch(ADDR_API + '?limit=10&lang=en&bbox=' + ADDR_BBOX + '&layer=house&layer=street&q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (d) { return d.features || []; })
          .catch(function () { delete cache[key]; return []; });
      }
      pending++;
      cache[key].then(function (features) {
        pending--;
        if (features.length) { pool.unshift(features); pool = pool.slice(0, 8); }
        refresh();
      });
    }
    function search() {
      var q = parse(input.value);
      if (q.query.replace(/[^a-z]/gi, '').length < 3) return;
      // The lookup knows most streets but not every house number, so search both ways.
      if (q.lookupNum) lookup(q.lookupNum + ' ' + q.query);
      lookup(q.query);
    }

    input.addEventListener('input', function () {
      state.addr = null;
      refresh(); // instant update from results we already have
      clearTimeout(timer);
      timer = setTimeout(search, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, active - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(active >= 0 ? active : 0); }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    // On phones, lift the field so suggestions aren't hidden behind the keyboard.
    input.addEventListener('focus', function () {
      if (isPhone()) setTimeout(function () { scrollToEl(input, 70); }, 300);
    });
  }

  function field(name, label, type, ac, full, extra, value) {
    return '<div class="bk-field' + (full ? ' full' : '') + '"><label for="bk-' + name + '">' + label + '</label>' +
      '<input id="bk-' + name + '" name="' + name + '" type="' + type + '" autocomplete="' + ac + '" ' + (extra || '') +
      ' value="' + esc(value || '') + '" required></div>';
  }
  function formValues() {
    var f = stepEl(3).querySelector('form');
    var v = {};
    ['firstName', 'lastName', 'phone', 'email', 'street', 'accessDetails', 'notes', 'company'].forEach(function (k) {
      v[k] = f ? (f.elements[k].value || '').trim() : '';
    });
    return v;
  }
  function validateDetails() {
    var v = formValues(), bad = [];
    if (!v.firstName) bad.push('firstName');
    if (!v.lastName) bad.push('lastName');
    if (v.phone.replace(/\D/g, '').length < 8) bad.push('phone');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) bad.push('email');
    // A picked suggestion needs a street number; a typed address needs a number and a suburb or postcode.
    if (state.addr ? !/^\S*\d/.test(state.addr.street) : !/\d/.test(v.street) || v.street.replace(/[^a-z]/gi, '').length < 6) bad.push('street');
    stepEl(3).querySelectorAll('.bk-field').forEach(function (el) { el.classList.remove('invalid'); });
    bad.forEach(function (k) { stepEl(3).querySelector('#bk-' + k).closest('.bk-field').classList.add('invalid'); });
    if (bad.length) {
      var first = stepEl(3).querySelector('#bk-' + bad[0]);
      scrollToEl(first, 110);
      first.focus({ preventScroll: true });
      var msgs = { firstName: 'Please add your first name.', lastName: 'Please add your last name.', phone: 'Please check your mobile number.',
        email: 'Please check your email address.', street: 'Please enter your full address, including the street number.' };
      return bad.length === 1 ? msgs[bad[0]] : 'Please check the highlighted details.';
    }
    if (!state.access) {
      scrollToEl(stepEl(3).querySelector('[data-access]'), 140);
      return 'Please tell us how we’ll get in.';
    }
    return null;
  }

  // ── summary ──
  function renderSummary() {
    var card = $('.bk-sum-card');
    var bar = $('.bk-bar-price');
    var closeBtn = '<button type="button" class="bk-sheet-close" aria-label="Close summary">' + icon('close', 2) + '</button>';
    if (!state.service) {
      card.innerHTML = closeBtn + '<p class="bk-sum-title">Your booking</p><p class="bk-sum-meta">Choose a clean to see your price.</p>' +
        '<div class="bk-sum-rows"><div class="bk-sum-row"><span>Regular clean</span><span>from $169</span></div>' +
        '<div class="bk-sum-row"><span>Deep clean</span><span>from $300</span></div>' +
        '<div class="bk-sum-row"><span>Bond clean</span><span>from $450</span></div></div>' +
        '<p class="bk-sum-note">No payment today. We text you a secure payment link after your clean.</p>';
      bar.innerHTML = '<span class="bk-bar-total">from $169</span><small>No payment today</small>';
    } else {
      var s = P.services[state.service], q = quote(), ex = chosenExtras();
      var beds = state.bedrooms + ' bed';
      var rows = [
        ['Home', beds + ', ' + state.bathrooms + ' bath'],
        ['Frequency', P.frequencyLabels[state.frequency]]
      ];
      if (q.hours) rows.push(['Time included', 'Up to ' + hrs(q.hours)]);
      if (state.slot) rows.push(['When', fmtDay.format(new Date(state.slot)) + ', ' + fmtTime.format(new Date(state.slot))]);
      var lines = [['Clean (' + beds + ')', q.quote ? 'Quoted' : money(q.base)]].concat(ex.map(function (x) {
        return [x.label, '+' + money(extraPrice())];
      }));

      var total = q.quote ? 'Quoted' : money(q.total);
      card.innerHTML = closeBtn +
        '<p class="bk-sum-title">' + esc(s.label) + '</p><p class="bk-sum-meta">' + esc(s.tagline) + '</p>' +
        '<div class="bk-sum-rows">' + rows.map(function (r) {
          return '<div class="bk-sum-row"><span>' + r[0] + '</span><span>' + esc(r[1]) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="bk-sum-rows bk-sum-lines">' + lines.map(function (r) {
          return '<div class="bk-sum-row"><span>' + esc(r[0]) + '</span><span>' + r[1] + '</span></div>';
        }).join('') + '</div>' +
        '<div class="bk-sum-total"><span>Total</span><span>' + total + '</span></div>' +
        (q.quote ? '<p class="bk-sum-note">Homes over 5 bedrooms are quoted individually. We’ll confirm your price before the clean' +
          (ex.length ? ', plus ' + money(q.extrasTotal) + ' for extras' : '') + '.</p>' : '') +
        '<div class="bk-sum-due"><span>Due today</span><span>$0</span></div>' +
        '<p class="bk-sum-note">Any extra time on the day is ' + money(s.extraPerHour) + "/hr and only with your approval. We'll text you a secure payment link after your clean.</p>";
      bar.innerHTML = '<span class="bk-bar-total">' + total + icon('up', 2.2) + '</span><small>' + esc(s.label) + ' · ' + beds + '</small>';
    }
    card.querySelector('.bk-sheet-close').addEventListener('click', function () { toggleSheet(false); });
  }

  // ── navigation ──
  function canContinue() {
    if (state.step === 0) return !!state.service;
    if (state.step === 2) return !!state.slot;
    return true;
  }
  function renderNav() {
    root.querySelectorAll('.bk-step').forEach(function (el) {
      el.classList.toggle('active', +el.dataset.step === state.step);
    });
    root.querySelectorAll('.bk-progress-step').forEach(function (el) {
      var i = +el.dataset.i;
      el.classList.toggle('done', i < state.step);
      el.classList.toggle('active', i === state.step);
    });
    if (state.step < 4) {
      $('.bk-top-count').textContent = 'Step ' + (state.step + 1) + ' of 4';
      $('.bk-top-name').textContent = STEPS[state.step];
    }
    root.classList.toggle('is-first', state.step === 0);
    root.style.setProperty('--bk-progress', Math.min(100, (state.step + 1) * 25) + '%');
    var head = document.querySelector('header');
    if (head) root.style.setProperty('--bk-head', head.offsetHeight + 'px');
    root.querySelectorAll('.bk-back').forEach(function (b) { b.hidden = state.step === 0; });
    var label = state.submitting ? 'Booking…'
      : state.step === 3 ? 'Confirm booking'
      : state.step === 1 && !chosenExtras().length ? 'Skip extras'
      : 'Continue';
    root.querySelectorAll('.bk-next').forEach(function (b) {
      b.textContent = label;
      b.disabled = state.submitting;
      b.classList.toggle('is-waiting', !canContinue());
    });
  }
  function scrollToEl(el, offset) {
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (offset || 90), behavior: 'smooth' });
  }
  function go(step, fromHistory) {
    state.step = step;
    setError('');
    toggleSheet(false);
    if (step === 1) renderStep1();
    if (step === 2) renderStep2();
    if (step === 3) renderStep3();
    renderNav();
    save();
    if (!fromHistory) {
      try { history.pushState({ bk: step }, '', '#' + ['clean', 'extras', 'time', 'details'][step]); } catch (e) { /* ignore */ }
    }
    // Start each step at its top.
    var top = root.getBoundingClientRect().top + window.scrollY - (isPhone() ? 64 : 90);
    if (window.scrollY > top || isPhone()) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  function next() {
    if (state.submitting) return;
    if (!canContinue()) {
      setError(state.step === 0 ? 'Choose a clean to continue.' : 'Choose a start time to continue.');
      if (state.step === 2) scrollToEl(stepEl(2).querySelector('.bk-times'), 110);
      return;
    }
    if (state.step === 0 && !state.checkoutTracked) {
      state.checkoutTracked = true;
      metaTrack('InitiateCheckout', metaParams());
    }
    if (state.step < 3) return go(state.step + 1);
    var err = validateDetails();
    if (err) return setError(err);
    submit();
  }
  function back() {
    if (state.step > 0 && state.step < 4 && !state.submitting) {
      // Use the browser's history so the iPhone swipe-back and our Back button agree.
      if (history.state && history.state.bk === state.step) history.back();
      else go(state.step - 1);
    }
  }
  window.addEventListener('popstate', function (e) {
    if (state.step === 4 || state.submitting) return;
    var target = e.state && typeof e.state.bk === 'number' ? e.state.bk : 0;
    if (target > 0 && !state.service) target = 0;
    if (target === 3 && !state.slot) target = 2;
    go(target, true);
  });

  // ── submit ──
  function submit() {
    var v = formValues();
    state.submitting = true; setError(''); renderNav();
    var payload = {
      service: state.service,
      bedrooms: state.bedrooms,
      bathrooms: state.bathrooms,
      frequency: state.frequency,
      extras: chosenExtras().map(function (x) { return x.id; }),
      startTime: state.slot,
      access: state.access,
      company: v.company,
      contact: {
        firstName: v.firstName, lastName: v.lastName, phone: v.phone, email: v.email,
        street: state.addr ? state.addr.street : v.street,
        suburb: state.addr ? state.addr.suburb : '',
        state: state.addr ? state.addr.state : '',
        postcode: state.addr ? state.addr.postcode : '',
        accessDetails: v.accessDetails, notes: v.notes
      }
    };
    fetch(API + '/booking-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (res) {
        state.submitting = false;
        if (res.r.ok && res.j.ok) return done(res.j);
        if (res.r.status === 409) {
          state.slot = null;
          loadSlots(true);
          go(2);
          renderSummary();
        } else {
          renderNav();
        }
        setError(res.j.error || 'Something went wrong. Please try again or call us on 0494 427 135.');
      })
      .catch(function () {
        state.submitting = false; renderNav();
        setError('Connection problem. Please check your internet and try again.');
      });
  }

  function done(res) {
    var s = P.services[state.service], q = quote();
    // Meta: Lead (what the ads optimise for) and Schedule (Meta's appointment
    // event), only after GoHighLevel has confirmed the booking.
    var params = metaParams();
    metaTrack('Lead', params, 'booking_' + res.bookingId);
    metaTrack('Schedule', params, 'booking_' + res.bookingId);
    // Google Ads: Book appointment conversion.
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'conversion', {
        'send_to': 'AW-467786744/00zfCM3i79EcEPi3h98B',
        'value': 1.0,
        'currency': 'GBP'
      });
    }
    clearSaved();
    var v = formValues();
    var el = stepEl(4);
    el.innerHTML = '<div class="bk-done"><div class="bk-done-icon">' + icon('check', 2.2) + '</div>' +
      '<h2 class="bk-h">You’re booked, ' + esc(v.firstName) + '!</h2>' +
      '<p class="bk-sub">' + esc(s.label) + ' on ' + fmtDayLong.format(new Date(state.slot)) + ' at ' + fmtTime.format(new Date(state.slot)) + '.</p>' +
      '<div class="bk-done-list">' +
      '<div class="bk-done-item"><span class="bk-done-num">1</span><span><strong>You’re all set.</strong> We’ll be in touch at ' + esc(v.phone) + ' if we need anything before your clean.</span></div>' +
      '<div class="bk-done-item"><span class="bk-done-num">2</span><span><strong>On the day,</strong> your cleaner does a quick walkthrough. If your home needs more time than usual, we’ll ask you first.</span></div>' +
      '<div class="bk-done-item"><span class="bk-done-num">3</span><span><strong>After your clean,</strong> we’ll text you a secure payment link.</span></div>' +
      '</div></div>';
    root.classList.add('is-done');
    state.step = 4;
    renderNav();
    try { history.replaceState({ bk: 4 }, '', '#booked'); } catch (e) { /* ignore */ }
    window.scrollTo({ top: Math.max(0, root.getBoundingClientRect().top + window.scrollY - 90), behavior: 'smooth' });
  }

  // Meta: Contact when someone taps a phone number on this page.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (a) metaTrack('Contact', { content_name: 'Phone call' });
  });

  // ── start ──
  fetch('/booking/pricing.json')
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (pricing) {
      P = pricing;
      TZ = P.timezone || TZ;
      fmtTime = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
      fmtDay = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
      fmtDayLong = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
      fmtWeekday = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short' });
      fmtMonthShort = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, month: 'short' });

      restore();
      // Links like /apply.html?service=bond&bedrooms=3 take priority over saved progress.
      var params = new URLSearchParams(location.search);
      if (P.services[params.get('service')]) {
        state.service = params.get('service');
        var fr = P.services[state.service].frequencies;
        if (fr.indexOf(state.frequency) === -1) state.frequency = fr[0];
        if (state.service === 'regular' && state.frequency === 'one_off') state.frequency = 'fortnightly';
        state.step = 0;
      }
      var beds = parseInt(params.get('bedrooms'), 10);
      if (beds >= 1 && beds <= P.maxBedrooms) state.bedrooms = beds;
      if (!state.service) state.step = 0;

      shell();
      renderStep0();
      if (state.service) renderStep1();
      renderSummary();
      try { history.replaceState({ bk: 0 }, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      if (state.step > 0) {
        // Rebuild history so swipe-back walks back through the steps.
        for (var i = 1; i <= state.step; i++) {
          try { history.pushState({ bk: i }, '', '#' + ['clean', 'extras', 'time', 'details'][i]); } catch (e) { /* ignore */ }
        }
        go(state.step, true);
      } else {
        renderNav();
      }
      loadSlots(); // warm up availability
    })
    .catch(function () {
      root.innerHTML = '<p class="bk-sub" style="text-align:center">Online booking is unavailable right now. Please call us on ' +
        '<a href="tel:+61494427135">0494 427 135</a> and we’ll book you in.</p>';
    });
})();
