/* ExperimentCheck ui: DOM wiring and rendering (browser only; SPEC 2.4 and 3).
 * Uses every ExperimentCheck namespace. Text is written with textContent and elements are built with
 * createElement / createElementNS only. No network, no dialogs, no storage other than the help-seen flag. */
(function (root) {
  'use strict';
  var EC = root.ExperimentCheck;
  if (!EC || EC.uiStarted) return; // run once
  EC.uiStarted = true;

  var stats = EC.stats, f = EC.format, validate = EC.validate, planLib = EC.plan;
  var readoutLib = EC.readout, memoLib = EC.memo, scenarios = EC.scenarios, stateLib = EC.state;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var HELP_KEY = 'experimentcheck.helpSeen.v1';
  var TABS = ['guide', 'plan', 'readout'];
  var MAX_GUARDRAILS = 10;

  var MSG = {
    wrong: 'Something went wrong while updating. Your inputs are kept; please report this with the share link.',
    badStart: 'This link could not be read, so the defaults were loaded.',
    badLink: 'This link could not be read, so nothing was changed.',
    loaded: 'Loaded the inputs from the link.',
    tooLong: 'The share link is too long to reopen; shorten the hypothesis or notes.',
    copied: 'Copied to the clipboard.',
    copyFail: 'Copy did not work in this browser. The text is selected; press Ctrl+C (Cmd+C on a Mac).',
    planInvalid: 'Complete the plan first: the readout needs the MDE, alpha and split from it.',
    noGuardrails: 'No guardrails in the plan. Add them in Plan before the test starts.',
    roEmpty: 'Enter your observed numbers to audit the result.',
    planUpdated: 'Plan updated',
    noCurve: 'Not enough traffic to draw the curve.'
  };

  var BADGE = { ship: 'SHIP', 'dont-ship': "DON'T SHIP", inconclusive: 'INCONCLUSIVE', investigate: 'INVESTIGATE', none: '' };
  var ICON = { PASS: '\u2713', WARN: '!', FAIL: '\u2717', INFO: 'i' };

  // Reason id -> glossary term id (SPEC 3.4).
  var REASON_TERM = {
    srm: 'srm',
    'guardrail-breach': 'guardrail', 'guardrail-at-risk': 'guardrail', 'guardrail-missing': 'guardrail', 'guardrail-na': 'guardrail',
    early: 'peeking', looks: 'peeking',
    obf: 'obf',
    'short-duration': 'novelty', 'partial-week': 'novelty',
    'sample-shortfall': 'power', underpowered: 'power',
    'ship-meaningful': 'practical', trivial: 'practical', 'below-mde': 'practical', flat: 'practical', 'primary-only': 'practical',
    borderline: 'p-value', 'no-variance': 'p-value',
    harm: 'ci',
    'small-counts': 'z-test',
    'small-n': 'welch',
    'dates-missing': 'prereg'
  };

  var PLAN_TEXT = {
    'ec-plan-name': 'name', 'ec-plan-metric-name': 'metricName',
    'ec-plan-baseline-rate': 'baselineRate', 'ec-plan-baseline-mean': 'baselineMean', 'ec-plan-baseline-sd': 'baselineSd',
    'ec-plan-mde': 'mde', 'ec-plan-alpha': 'alpha', 'ec-plan-power': 'power', 'ec-plan-share': 'share',
    'ec-plan-daily': 'daily', 'ec-plan-start': 'start', 'ec-plan-hypothesis': 'hypothesis', 'ec-plan-notes': 'notes'
  };
  var PLAN_RADIO = { 'ec-plan-type': 'type', 'ec-plan-dir': 'direction', 'ec-plan-mde-type': 'mdeType', 'ec-plan-sides': 'sides' };
  var RO_TEXT = { 'ec-ro-through': 'through', 'ec-ro-looks': 'looks', 'ec-ro-srm-threshold': 'srmThreshold' };
  var ARM_NAME = { c: 'control', t: 'treatment' };
  var RE_RO_ARM = /^ec-ro-([ct])-(n|x|mean|sd)$/;
  var RE_GR = /^ec-gr-(g[0-9]+)-(name|type|dir|margin)$/;
  var RE_RG = /^ec-rg-(g[0-9]+)-([ct])-(n|x|mean|sd)$/;

  // ---- Session state ------------------------------------------------------------------------

  var raw = stateLib.defaults();
  var gidCounter = 0;       // never reused within the session (SPEC 3.9)
  var undoState = null;     // one level only
  var lastHash = null;
  var lastVerdict = null;
  var lastPlanAnnounce = 0;
  var recomputeTimer = null, hashTimer = null, pendingPlanEdit = false;
  var current = { preregMd: '', memoMd: '', audit: null };

  // ---- Safe DOM helpers (SPEC 3.9) ----------------------------------------------------------

  function $(id) { return document.getElementById(id); }
  function readField(id) { var el = $(id); return el ? String(el.value) : ''; }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function setHidden(id, hidden) { var el = $(id); if (el) el.hidden = !!hidden; }
  function clear(el) { if (el) while (el.firstChild) el.removeChild(el.firstChild); }
  function make(tag, text, cls) {
    var el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function svg(tag, attrs, text) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function emptyArm() { return { n: '', x: '', mean: '', sd: '' }; }

  // ---- Storage (SPEC 3.3) --------------------------------------------------------------------

  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function helpSeen() { return storageGet(HELP_KEY) === '1'; }
  function markHelpSeen() { storageSet(HELP_KEY, '1'); setHidden('ec-newhere', true); }

  // ---- Status line --------------------------------------------------------------------------

  function status(msg) { setText('ec-status-msg', msg); }
  function showUndo() { setHidden('ec-undo', false); }
  function clearUndo() { undoState = null; setHidden('ec-undo', true); }

  function warn(err) {
    status(MSG.wrong);
    if (root.console && typeof root.console.warn === 'function') root.console.warn('ExperimentCheck:', err);
  }
  // Top-level guard for every event handler (SPEC 3.10).
  function guard(fn) {
    return function (e) { try { return fn(e); } catch (err) { warn(err); } };
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function slug(name) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return s === '' ? 'experiment' : s;
  }

  // ---- Tabs (SPEC 3.2) ----------------------------------------------------------------------

  function selectTab(name, opts) {
    opts = opts || {};
    if (TABS.indexOf(name) < 0) name = 'plan';
    TABS.forEach(function (t) {
      var tab = $('ec-tab-' + t), panel = $('ec-panel-' + t), sel = t === name;
      if (tab) { tab.setAttribute('aria-selected', sel ? 'true' : 'false'); tab.tabIndex = sel ? 0 : -1; }
      if (panel) panel.hidden = !sel;
    });
    if (raw.tab !== name) { raw.tab = name; if (!opts.noHash) scheduleHash(); }
    if (opts.focus) { var el = $('ec-tab-' + name); if (el) el.focus(); }
    if (opts.user && name !== 'guide') markHelpSeen();
  }

  function onTabKey(e) {
    var t = e.target;
    if (!t || t.getAttribute('role') !== 'tab') return;
    var i = TABS.indexOf(t.id.replace('ec-tab-', ''));
    var n;
    switch (e.key) {
      case 'ArrowRight': case 'Right': n = (i + 1) % TABS.length; break;
      case 'ArrowLeft': case 'Left': n = (i + TABS.length - 1) % TABS.length; break;
      case 'Home': n = 0; break;
      case 'End': n = TABS.length - 1; break;
      case 'Enter': case ' ': case 'Spacebar': n = i; break;
      default: return;
    }
    e.preventDefault();
    selectTab(TABS[n], { focus: true, user: true });
  }

  // ---- State <-> DOM ------------------------------------------------------------------------

  function bumpCounter() {
    (raw.plan.guardrails || []).forEach(function (g) {
      var n = parseInt(String(g.id).slice(1), 10);
      if (n > gidCounter) gidCounter = n;
    });
  }

  function setValue(id, value) { var el = $(id); if (el && el.value !== value) el.value = value; }

  function syncDom() {
    Object.keys(PLAN_TEXT).forEach(function (id) { setValue(id, raw.plan[PLAN_TEXT[id]]); });
    Object.keys(PLAN_RADIO).forEach(function (name) {
      var v = raw.plan[PLAN_RADIO[name]];
      var list = document.getElementsByName(name);
      for (var i = 0; i < list.length; i++) list[i].checked = list[i].value === v;
    });
    Object.keys(RO_TEXT).forEach(function (id) { setValue(id, raw.readout[RO_TEXT[id]]); });
    ['c', 't'].forEach(function (a) {
      ['n', 'x', 'mean', 'sd'].forEach(function (k) { setValue('ec-ro-' + a + '-' + k, raw.readout[ARM_NAME[a]][k]); });
    });
    buildPlanGuardrails();
    buildRoGuardrails();
    applyVisibility();
  }

  function applyVisibility() {
    var binary = raw.plan.type !== 'continuous';
    var i, list = document.querySelectorAll('.ec-only-binary');
    for (i = 0; i < list.length; i++) list[i].hidden = !binary;
    list = document.querySelectorAll('.ec-only-continuous');
    for (i = 0; i < list.length; i++) list[i].hidden = binary;
    setText('ec-ro-c-n-label', binary ? 'Control users' : 'Control users (n)');
    setText('ec-ro-t-n-label', binary ? 'Treatment users' : 'Treatment users (n)');
  }

  function findGuardrail(gid) {
    var list = raw.plan.guardrails;
    for (var i = 0; i < list.length; i++) if (list[i].id === gid) return { g: list[i], i: i };
    return null;
  }

  function roGuardrail(gid) {
    if (!own(raw.readout.guardrails, gid)) raw.readout.guardrails[gid] = { control: emptyArm(), treatment: emptyArm() };
    return raw.readout.guardrails[gid];
  }

  // Copies one edited control into the raw state. Returns 'plan', 'readout' or null.
  function applyField(el) {
    var id = el.id || '';
    if (el.type === 'radio' && own(PLAN_RADIO, el.name)) {
      if (!el.checked) return null;
      raw.plan[PLAN_RADIO[el.name]] = el.value;
      if (el.name === 'ec-plan-type') applyVisibility();
      return 'plan';
    }
    if (own(PLAN_TEXT, id)) { raw.plan[PLAN_TEXT[id]] = String(el.value); return 'plan'; }
    if (own(RO_TEXT, id)) { raw.readout[RO_TEXT[id]] = String(el.value); return 'readout'; }
    var m = RE_RO_ARM.exec(id);
    if (m) { raw.readout[ARM_NAME[m[1]]][m[2]] = String(el.value); return 'readout'; }
    m = RE_GR.exec(id);
    if (m) {
      var found = findGuardrail(m[1]);
      if (!found) return null;
      var key = m[2] === 'dir' ? 'direction' : m[2];
      found.g[key] = String(el.value);
      if (key === 'name') updateGuardrailNames(found.g, found.i);
      if (key === 'type') buildRoGuardrails();
      return 'plan';
    }
    m = RE_RG.exec(id);
    if (m) {
      if (!findGuardrail(m[1])) return null;
      roGuardrail(m[1])[ARM_NAME[m[2]]][m[3]] = String(el.value);
      return 'readout';
    }
    return null;
  }

  function onInput(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var kind = applyField(el);
    if (!kind) return;
    clearUndo();
    scheduleRecompute(kind === 'plan');
    scheduleHash();
  }

  // ---- Guardrail rows (SPEC 3.5, 3.6) -------------------------------------------------------

  function field(id, labelText, control, opts) {
    opts = opts || {};
    var wrap = make('div', null, 'ec-field');
    var label = make('label', labelText);
    label.htmlFor = id;
    control.id = id;
    if (opts.describe !== false) control.setAttribute('aria-describedby', id + '-err');
    wrap.appendChild(label);
    wrap.appendChild(control);
    if (opts.describe !== false) {
      var err = make('p', null, 'ec-err');
      err.id = id + '-err';
      err.hidden = true;
      wrap.appendChild(err);
    }
    return wrap;
  }

  function textInput(value, mode, max) {
    var el = document.createElement('input');
    el.type = 'text';
    if (mode) el.setAttribute('inputmode', mode);
    el.maxLength = max;
    el.autocomplete = 'off';
    el.value = value || '';
    return el;
  }

  function selectBox(options, value) {
    var el = document.createElement('select');
    options.forEach(function (o) {
      var opt = make('option', o[1]);
      opt.value = o[0];
      el.appendChild(opt);
    });
    el.value = value;
    return el;
  }

  function removeLabel(g, i) { return 'Remove guardrail ' + (String(g.name).trim() || String(i + 1)); }
  function guardrailHeading(g, i) { return String(g.name).trim() || 'Guardrail ' + (i + 1); }

  function buildPlanGuardrails() {
    var box = $('ec-plan-guardrails');
    if (!box) return;
    clear(box);
    raw.plan.guardrails.forEach(function (g, i) {
      var base = 'ec-gr-' + g.id;
      var row = make('div', null, 'ec-gr-row');
      row.setAttribute('data-gid', g.id);
      row.appendChild(field(base + '-name', 'Guardrail name', textInput(g.name, null, 60)));
      row.appendChild(field(base + '-type', 'Guardrail type',
        selectBox([['binary', 'Rate (yes/no)'], ['continuous', 'Average (mean)']], g.type), { describe: false }));
      row.appendChild(field(base + '-dir', 'Better when',
        selectBox([['decrease', 'Lower is better'], ['increase', 'Higher is better']], g.direction), { describe: false }));
      row.appendChild(field(base + '-margin', 'Max acceptable degradation (% relative)', textInput(g.margin, 'decimal', 32)));
      var rm = make('button', 'Remove');
      rm.type = 'button';
      rm.id = base + '-remove';
      rm.setAttribute('data-remove', g.id);
      rm.setAttribute('aria-label', removeLabel(g, i));
      row.appendChild(rm);
      box.appendChild(row);
    });
    var add = $('ec-plan-guardrail-add');
    if (add) add.disabled = raw.plan.guardrails.length >= MAX_GUARDRAILS;
  }

  function updateGuardrailNames(g, i) {
    var rm = $('ec-gr-' + g.id + '-remove');
    if (rm) rm.setAttribute('aria-label', removeLabel(g, i));
    setText('ec-rg-' + g.id + '-heading', guardrailHeading(g, i));
  }

  var ARM_LABEL = { c: 'Control', t: 'Treatment' };
  var FIELD_LABEL = { n: 'users', x: 'conversions', mean: 'mean', sd: 'standard deviation' };

  function buildRoGuardrails() {
    var box = $('ec-ro-guardrails');
    if (!box) return;
    clear(box);
    var list = raw.plan.guardrails;
    if (!list.length) { box.appendChild(make('p', MSG.noGuardrails)); return; }
    list.forEach(function (g, i) {
      var block = make('div', null, 'ec-rg-block');
      var h = make('h4', guardrailHeading(g, i));
      h.id = 'ec-rg-' + g.id + '-heading';
      block.appendChild(h);
      var data = own(raw.readout.guardrails, g.id) ? raw.readout.guardrails[g.id] : { control: emptyArm(), treatment: emptyArm() };
      var keys = g.type === 'continuous' ? ['n', 'mean', 'sd'] : ['n', 'x'];
      var arms = make('div', null, 'ec-arms');
      ['c', 't'].forEach(function (a) {
        var fs = make('fieldset', null, 'ec-arm');
        fs.appendChild(make('legend', ARM_LABEL[a]));
        keys.forEach(function (k) {
          var id = 'ec-rg-' + g.id + '-' + a + '-' + k;
          var mode = k === 'n' || k === 'x' ? 'numeric' : 'decimal';
          fs.appendChild(field(id, ARM_LABEL[a] + ' ' + FIELD_LABEL[k], textInput(data[ARM_NAME[a]][k], mode, 32)));
        });
        arms.appendChild(fs);
      });
      block.appendChild(arms);
      box.appendChild(block);
    });
  }

  function addGuardrail() {
    if (raw.plan.guardrails.length >= MAX_GUARDRAILS) return;
    gidCounter += 1;
    var gid = 'g' + gidCounter;
    raw.plan.guardrails.push({ id: gid, name: '', type: 'binary', direction: 'decrease', margin: '5' });
    clearUndo();
    buildPlanGuardrails();
    buildRoGuardrails();
    var el = $('ec-gr-' + gid + '-name');
    if (el) el.focus();
    scheduleRecompute(true);
    scheduleHash();
  }

  function removeGuardrail(gid) {
    raw.plan.guardrails = raw.plan.guardrails.filter(function (g) { return g.id !== gid; });
    if (own(raw.readout.guardrails, gid)) delete raw.readout.guardrails[gid];
    clearUndo();
    buildPlanGuardrails();
    buildRoGuardrails();
    var add = $('ec-plan-guardrail-add');
    if (add) add.focus();
    scheduleRecompute(true);
    scheduleHash();
  }

  // ---- Recompute and render (SPEC 2.4) ------------------------------------------------------

  function scheduleRecompute(planEdit) {
    if (planEdit) pendingPlanEdit = true;
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(function () {
      recomputeTimer = null;
      var pe = pendingPlanEdit;
      pendingPlanEdit = false;
      recompute({ planEdit: pe });
    }, 150);
  }

  function recompute(opts) {
    try { render(opts || {}); } catch (err) { warn(err); }
    return current.audit;
  }

  function render(opts) {
    applyVisibility();
    var parsed = validate.parsePlan(raw.plan);
    var pr = parsed.ok ? planLib.computePlan(parsed.value) : null;
    var planOk = !!(parsed.ok && pr && pr.ok);
    var ro = null, au = null;
    if (planOk) {
      ro = validate.parseReadout(raw.readout, parsed);
      au = readoutLib.audit(parsed, pr, ro);
    }
    var errors = {};
    Object.keys(parsed.errors || {}).forEach(function (k) { errors[k] = parsed.errors[k]; });
    if (ro && !ro.empty) Object.keys(ro.errors || {}).forEach(function (k) { errors[k] = ro.errors[k]; });

    renderFieldErrors(errors);
    renderPlan(parsed, pr, planOk, errors);
    renderReadout(parsed, pr, planOk, ro, au, errors);

    if (opts.planEdit && planOk && Date.now() - lastPlanAnnounce >= 2000) {
      lastPlanAnnounce = Date.now();
      status(MSG.planUpdated);
    }
    var v = au ? au.verdict : 'none';
    if (!opts.quiet && lastVerdict !== null && v !== lastVerdict) status('Verdict: ' + (au ? au.label : readoutLib.LABELS.none));
    lastVerdict = v;
    current.audit = au || { verdict: 'none', label: readoutLib.LABELS.none };
  }

  function renderFieldErrors(errors) {
    var list = document.querySelectorAll('.ec-err');
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var fid = p.id.slice(0, -4);
      var ctrl = $(fid);
      var msg = own(errors, fid) ? errors[fid] : '';
      p.textContent = msg;
      p.hidden = !msg;
      if (ctrl) {
        if (msg) ctrl.setAttribute('aria-invalid', 'true');
        else ctrl.removeAttribute('aria-invalid');
      }
    }
  }

  function labelFor(id) {
    var labels = document.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) if (labels[i].htmlFor === id) return labels[i].textContent;
    return id;
  }

  // Error summary box (SPEC 3.5 / 3.11): a heading and one button per invalid field, in page order.
  function renderSummary(prefix, panelId, errors, title) {
    var panel = $(panelId), box = $(prefix + '-summary-errors'), listEl = $(prefix + '-summary-list');
    var jump = $(prefix + '-errors-jump');
    var keys = [], seen = {};
    if (panel) {
      var errs = panel.querySelectorAll('.ec-err');
      for (var i = 0; i < errs.length; i++) {
        var fid = errs[i].id.slice(0, -4);
        if (own(errors, fid) && !seen[fid]) { keys.push(fid); seen[fid] = true; }
      }
    }
    clear(listEl);
    keys.forEach(function (fid) {
      var li = make('li');
      var b = make('button', labelFor(fid) + ': ' + errors[fid]);
      b.type = 'button';
      b.setAttribute('data-focus', fid);
      li.appendChild(b);
      listEl.appendChild(li);
    });
    var n = keys.length;
    if (box) { box.hidden = n === 0; box.classList.remove('ec-neutral'); }
    setText(prefix + '-summary-title', title(n));
    if (jump) { jump.hidden = n === 0; jump.textContent = 'Show errors (' + n + ')'; }
    return n;
  }

  function isBinaryPlan() { return raw.plan.type !== 'continuous'; }
  function unitText(x) { return isBinaryPlan() ? f.pp(x) : f.snum(x); }
  function weeksText(w) { return w === 1 ? '1 week' : w + ' weeks'; }

  function mdeHint(pr, planOk) {
    var binary = isBinaryPlan(), rel = raw.plan.mdeType !== 'absolute';
    var unit = binary
      ? (rel ? 'Percent of the baseline rate.' : 'Percentage points (pp).')
      : (rel ? 'Percent of the baseline mean.' : 'Metric units.');
    if (planOk) unit += ' Target: ' + (binary ? f.pct(pr.target) : f.num(pr.target));
    return unit;
  }

  function renderPlan(parsed, pr, planOk, errors) {
    var planErrors = {};
    Object.keys(parsed.errors || {}).forEach(function (k) { planErrors[k] = errors[k]; });
    renderSummary('ec-plan', 'ec-panel-plan', planErrors, function (n) { return 'Fix ' + n + ' field(s) to see the plan.'; });
    setHidden('ec-plan-infeasible', !(parsed.ok && !planOk));
    setHidden('ec-plan-output', !planOk);
    setText('ec-plan-mde-hint', mdeHint(pr, planOk));
    if (!planOk) { current.preregMd = ''; setValue('ec-prereg-md', ''); return; }

    var binary = isBinaryPlan();
    setText('ec-out-n-control', f.int(pr.nControl));
    setText('ec-out-n-treatment', f.int(pr.nTreatment));
    setText('ec-out-n-total', f.int(pr.total));
    setText('ec-out-target', binary ? f.pct(pr.target) : f.num(pr.target));
    setText('ec-out-days-raw', f.df(pr.rawDays));
    setText('ec-out-days-rec', pr.recommendedDays + ' days (' + pr.weeks + ' full week' + (pr.weeks === 1 ? '' : 's') + ')');
    setText('ec-out-end', pr.plannedEnd || 'Set a start date');
    var adv = $('ec-out-advice');
    clear(adv);
    pr.advice.forEach(function (a) { adv.appendChild(make('p', a)); });

    renderSensitivity(pr, binary);
    renderChart(pr);

    var thr = validate.parseNumber(raw.readout.srmThreshold, {});
    var srm = thr.ok && thr.value >= 0.00001 && thr.value <= 0.05 ? thr.value : 0.001;
    var doc = memoLib.buildPrereg({ plan: parsed, planResult: pr, srmThreshold: srm, version: stateLib.VERSION, generatedOn: today() });
    current.preregMd = memoLib.toMarkdown(doc);
    current.preregName = 'prereg-' + slug(raw.plan.name) + '.md';
    setValue('ec-prereg-md', current.preregMd);
  }

  function renderSensitivity(pr, binary) {
    var body = $('ec-sens-body');
    clear(body);
    pr.sensitivity.forEach(function (r) {
      var tr = make('tr', null, r.isPlan ? 'ec-row-plan' : null);
      var detectable = isFinite(r.mdeAbs);
      var cells = [
        weeksText(r.weeks) + ' (' + r.days + ' days)' + (r.isPlan ? ' (plan)' : ''),
        f.int(r.nC) + ' / ' + f.int(r.nT),
        !detectable ? 'not detectable' : (binary ? f.ppAbs(r.mdeAbs) : f.num(r.mdeAbs)),
        !detectable ? 'not detectable' : (pr.baselinePositive ? f.pct(r.mdeRel) : 'n/a')
      ];
      cells.forEach(function (c) { tr.appendChild(make('td', c)); });
      body.appendChild(tr);
    });
  }

  function niceCeil(max) {
    if (!(max > 0) || !isFinite(max)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= max * (1 - 1e-12)) return steps[i] * p;
    return 10 * p;
  }

  // Sensitivity chart (SPEC 3.8), inline SVG.
  function renderChart(pr) {
    var chart = $('ec-sens-chart');
    if (!chart) return;
    var kids = Array.prototype.slice.call(chart.childNodes);
    kids.forEach(function (k) { if (k.id !== 'ec-sens-title' && k.id !== 'ec-sens-desc') chart.removeChild(k); });
    var bp = pr.baselinePositive;
    var days = planLib.SENS_DAYS;
    var pts = [];
    pr.sensitivity.forEach(function (r) {
      if (days.indexOf(r.days) < 0) return;
      var v = bp ? 100 * r.mdeRel : r.mdeAbs;
      if (isFinite(v)) pts.push({ days: r.days, weeks: r.weeks, v: v, row: r });
    });
    var valueText = function (r) { return bp ? f.pct(r.mdeRel) + ' relative' : f.num(r.mdeAbs) + ' units'; };
    if (pts.length < 2) {
      setText('ec-sens-desc', MSG.noCurve);
      chart.appendChild(svg('text', { x: 320, y: 150, 'text-anchor': 'middle' }, MSG.noCurve));
      return;
    }
    var first = pts[0], last = pts[pts.length - 1];
    setText('ec-sens-desc', 'At ' + weeksText(first.weeks) + ' the test can detect ' + valueText(first.row) +
      '; at ' + weeksText(last.weeks) + ', ' + valueText(last.row) + '.');

    var x = function (d) { return 60 + (d - 7) / (84 - 7) * 560; };
    var max = 0;
    pts.forEach(function (p) { if (p.v > max) max = p.v; });
    var top = niceCeil(max);
    var y = function (v) { return 250 - v / top * 230; };
    var label = function (v) { return bp ? (top < 5 ? v.toFixed(1) : v.toFixed(0)) : f.num(v); };

    for (var i = 0; i <= 5; i++) {
      var gv = top * i / 5;
      chart.appendChild(svg('line', { x1: 60, x2: 620, y1: y(gv), y2: y(gv), 'class': i === 0 ? 'ec-sens-axis' : 'ec-sens-grid' }));
      chart.appendChild(svg('text', { x: 54, y: y(gv) + 4, 'text-anchor': 'end' }, label(gv)));
    }
    chart.appendChild(svg('line', { x1: 60, x2: 60, y1: 20, y2: 250, 'class': 'ec-sens-axis' }));
    days.forEach(function (d) {
      chart.appendChild(svg('line', { x1: x(d), x2: x(d), y1: 250, y2: 255, 'class': 'ec-sens-axis' }));
      chart.appendChild(svg('text', { x: x(d), y: 270, 'text-anchor': 'middle' }, (d / 7) + 'w'));
    });
    chart.appendChild(svg('text', { x: 340, y: 292, 'text-anchor': 'middle' }, 'Test duration (weeks)'));
    chart.appendChild(svg('text', { x: 14, y: 135, 'text-anchor': 'middle', transform: 'rotate(-90 14 135)' },
      bp ? 'Detectable change (% relative)' : 'Detectable change (units)'));

    var R = pr.recommendedDays;
    if (R >= 7 && R <= 84) {
      chart.appendChild(svg('line', { x1: x(R), x2: x(R), y1: 20, y2: 250, 'class': 'ec-sens-plan' }));
      chart.appendChild(svg('text', { x: x(R) + 4, y: 32 }, 'plan'));
    }
    chart.appendChild(svg('polyline', {
      'class': 'ec-sens-line',
      points: pts.map(function (p) { return x(p.days).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ')
    }));
    pts.forEach(function (p) {
      var c = svg('circle', { cx: x(p.days).toFixed(1), cy: y(p.v).toFixed(1), r: 4 });
      c.appendChild(svg('title', {}, weeksText(p.weeks) + ': ' + valueText(p.row)));
      chart.appendChild(c);
    });
  }

  function planSummaryText(parsed, pr) {
    var p = parsed.value, binary = p.type !== 'continuous';
    var metric = String(p.metricName || '').trim() || 'Primary metric';
    var mde = unitText(pr.mdeAbs) + (pr.baselinePositive ? ' (' + f.pct(pr.mdeRel) + ' relative)' : '');
    return 'Plan in use: ' + metric + ' (' + (binary ? 'conversion rate' : 'mean') + ', ' + (p.dir < 0 ? 'lower' : 'higher') +
      ' is better); MDE ' + mde + '; alpha ' + f.num(100 * p.alpha) + '%, ' + (p.sides === 1 ? 'one-sided' : 'two-sided') +
      '; split ' + f.num(100 * (1 - p.share)) + '% control / ' + f.num(100 * p.share) + '% treatment; planned ' +
      f.int(pr.total) + ' users; planned end ' + (pr.plannedEnd || 'not set (no start date)') + '.';
  }

  function renderReadout(parsed, pr, planOk, ro, au, errors) {
    setHidden('ec-ro-plan-invalid', planOk);
    setHidden('ec-ro-body', !planOk);
    if (!planOk) {
      setText('ec-ro-plan-invalid-msg', parsed.ok ? planLib.INFEASIBLE_MESSAGE : MSG.planInvalid);
      renderMemo(null, null, null, null);
      return;
    }
    setText('ec-ro-plan-text', planSummaryText(parsed, pr));

    var roErrors = {};
    if (ro && !ro.empty) Object.keys(ro.errors || {}).forEach(function (k) { roErrors[k] = errors[k]; });
    var n = renderSummary('ec-ro', 'ec-panel-readout', roErrors, function (k) { return 'Fix ' + k + ' field(s) to see the audit.'; });
    if (ro && ro.empty) {
      var box = $('ec-ro-summary-errors');
      box.hidden = false;
      box.classList.add('ec-neutral');
      setText('ec-ro-summary-title', MSG.roEmpty);
    } else if (n === 0) {
      setHidden('ec-ro-summary-errors', true);
    }

    renderVerdict(au);
    var hasAudit = !!(au && au.verdict !== 'none');
    setHidden('ec-ro-details', !hasAudit);
    if (hasAudit) {
      renderEffect(ro.value, au, pr);
      renderChecks(au);
    }
    renderMemo(hasAudit ? parsed : null, pr, ro, au);
  }

  function renderVerdict(au) {
    var v = au ? au.verdict : 'none';
    var card = $('ec-verdict');
    if (card) card.setAttribute('data-verdict', v);
    setText('ec-verdict-badge', BADGE[v] || '');
    setText('ec-verdict-label', au ? au.label : readoutLib.LABELS.none);
    setText('ec-verdict-summary', au && au.summary ? au.summary : '');
    setText('ec-verdict-next', au && au.next ? au.next : '');
    var list = $('ec-verdict-reasons');
    clear(list);
    ((au && au.reasons) || []).forEach(function (r) {
      var li = make('li', null, 'ec-reason-' + r.status);
      li.setAttribute('data-reason', r.id);
      li.appendChild(make('span', r.text));
      var term = REASON_TERM[r.id];
      if (term && $('ec-g-' + term)) {
        var b = make('button', 'What is this?');
        b.type = 'button';
        b.setAttribute('data-term', term);
        b.setAttribute('aria-label', 'What is this? ' + $('ec-g-' + term).textContent);
        li.appendChild(document.createTextNode(' '));
        li.appendChild(b);
      }
      list.appendChild(li);
    });
  }

  function renderEffect(ro, au, pr) {
    var binary = isBinaryPlan();
    var head = $('ec-effect-head'), body = $('ec-effect-body');
    clear(head);
    clear(body);
    (binary ? ['Arm', 'Users', 'Conversions', 'Conversion rate'] : ['Arm', 'Users (n)', 'Mean', 'SD']).forEach(function (h) {
      var th = make('th', h);
      th.scope = 'col';
      head.appendChild(th);
    });
    [['Control', ro.control], ['Treatment', ro.treatment]].forEach(function (row) {
      var a = row[1];
      var cells = binary ? [row[0], f.int(a.n), f.int(a.x), f.pct(a.x / a.n)] : [row[0], f.int(a.n), f.num(a.mean), f.num(a.sd)];
      var tr = make('tr');
      cells.forEach(function (c, i) {
        var cell = make(i === 0 ? 'th' : 'td', c);
        if (i === 0) cell.scope = 'row';
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    var p = au.primary || {};
    var level = p.level || '';
    var ci = p.ci || [NaN, NaN], relCi = p.relCi || [NaN, NaN];
    var sides = p.sides === 1 ? 'one-sided' : 'two-sided';
    setText('ec-out-diff', unitText(p.diff) + ' (' + level + ' CI ' + unitText(ci[0]) + ' to ' + unitText(ci[1]) + ')');
    setText('ec-out-rel', isFinite(p.rel)
      ? f.spct(p.rel) + ' (' + level + ' CI ' + f.spct(relCi[0]) + ' to ' + f.spct(relCi[1]) + (binary ? ')' : ', approximate)')
      : 'n/a (' + (p.relNa || '') + ')');
    if (!p.computable) setText('ec-out-test', 'Not computable: no variation in the data.');
    else if (binary) setText('ec-out-test', 'z = ' + f.stat(p.z) + ', ' + f.pText(p.p) + ' (' + sides + ')');
    else setText('ec-out-test', 't = ' + f.stat(p.t) + ', df = ' + f.df(p.df) + ', ' + f.pText(p.p) + ' (' + sides + ')');
    if (!p.computable) setText('ec-out-mde', 'n/a');
    else {
      var meets = readoutLib.meetsMde(p.e, pr.mdeAbs);
      setText('ec-out-mde', 'Observed effect ' + unitText(p.e) + ' (positive is better) vs the MDE ' + unitText(pr.mdeAbs) +
        ': ' + (meets ? 'at least the MDE.' : 'below the MDE.'));
    }
  }

  function statusCell(st) {
    var td = make('td');
    var icon = make('span', ICON[st] || '');
    icon.setAttribute('aria-hidden', 'true');
    td.appendChild(icon);
    td.appendChild(document.createTextNode(' '));
    td.appendChild(make('span', st, 'ec-st-' + st));
    return td;
  }

  function renderChecks(au) {
    var body = $('ec-checks-body');
    clear(body);
    (au.checks || []).forEach(function (ch) {
      var tr = make('tr');
      tr.setAttribute('data-check', ch.id);
      tr.setAttribute('data-status', ch.status);
      var th = make('th', ch.label);
      th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(statusCell(ch.status));
      tr.appendChild(make('td', ch.detail));
      body.appendChild(tr);
    });
  }

  // Memo preview from the document blocks (SPEC 3.6, 8.3).
  function renderMemo(parsed, pr, ro, au) {
    var preview = $('ec-memo-preview');
    clear(preview);
    var ready = !!(parsed && au && au.verdict !== 'none');
    ['ec-memo-copy', 'ec-memo-download', 'ec-memo-print'].forEach(function (id) { var b = $(id); if (b) b.disabled = !ready; });
    setHidden('ec-memo-empty', ready);
    if (!ready) { current.memoMd = ''; setValue('ec-memo-md', ''); return; }
    var doc = memoLib.buildMemo({ plan: parsed, planResult: pr, readout: ro, audit: au, version: stateLib.VERSION, generatedOn: today() });
    current.memoMd = memoLib.toMarkdown(doc);
    current.memoName = 'decision-memo-' + slug(raw.plan.name) + '.md';
    setValue('ec-memo-md', current.memoMd);
    doc.blocks.forEach(function (b) {
      if (!b) return;
      if (b.type === 'h1') preview.appendChild(make('h3', b.text, 'ec-memo-title'));
      else if (b.type === 'h2') preview.appendChild(make('h4', b.text));
      else if (b.type === 'p') preview.appendChild(make('p', b.text));
      else if (b.type === 'strong-p') {
        var p = make('p');
        p.appendChild(make('strong', b.strong));
        p.appendChild(document.createTextNode(' ' + b.text));
        preview.appendChild(p);
      } else if (b.type === 'ul') {
        var ul = make('ul');
        (b.items || []).forEach(function (it) { ul.appendChild(make('li', it)); });
        preview.appendChild(ul);
      } else if (b.type === 'table') {
        var wrap = make('div', null, 'ec-scroll');
        var table = make('table');
        var thead = make('thead'), hr = make('tr');
        var header = b.header || [];
        header.forEach(function (h) { var th = make('th', h); th.scope = 'col'; hr.appendChild(th); });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = make('tbody');
        (b.rows || []).forEach(function (r) {
          var tr = make('tr');
          r.forEach(function (c, i) {
            var td = make('td', c);
            if (header[i] === 'Result' && ICON[c]) td.className = 'ec-st-' + c;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        preview.appendChild(wrap);
      }
    });
  }

  // ---- URL hash (SPEC 7.2) ------------------------------------------------------------------

  function scheduleHash() {
    if (hashTimer) clearTimeout(hashTimer);
    hashTimer = setTimeout(guard(writeHash), 400);
  }

  function writeHash() {
    if (hashTimer) { clearTimeout(hashTimer); hashTimer = null; }
    var h = stateLib.encode(stateLib.sanitize(raw));
    lastHash = h;
    try { history.replaceState(null, '', h); } catch (e) { location.replace(h); }
    var su = $('ec-share-url');
    if (su) su.value = location.href;
    if (h.length > stateLib.MAX_HASH) status(MSG.tooLong);
  }

  // Replaces the whole raw state (link, example, undo, reset) and re-renders.
  function replaceState(next) {
    raw = next;
    bumpCounter();
    syncDom();
    selectTab(raw.tab, { noHash: true });
    return recompute({ quiet: true });
  }

  function onHashChange() {
    if (location.hash === lastHash) return;
    var d = stateLib.decode(location.hash);
    if (d.ok) {
      clearUndo();
      replaceState(d.state);
      writeHash();
      status(MSG.loaded);
    } else {
      status(MSG.badLink);
    }
  }

  // ---- Examples, undo, reset ----------------------------------------------------------------

  function findScenario(id) {
    var list = scenarios.list;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function loadExample(id) {
    var sc = findScenario(id);
    if (!sc) return;
    var before = clone(raw);
    var au = replaceState(stateLib.sanitize(clone(sc.state)));
    undoState = before;
    showUndo();
    setValue('ec-example-select', sc.id);
    scheduleHash();
    status('Loaded the example "' + sc.title + '". Verdict: ' + (au ? au.label : readoutLib.LABELS.none) + '.');
  }

  function undo() {
    if (!undoState) return;
    var prev = undoState;
    clearUndo();
    var au = replaceState(prev);
    scheduleHash();
    var sel = $('ec-example-select');
    if (sel) sel.focus();
    status('Restored the previous inputs. Verdict: ' + (au ? au.label : readoutLib.LABELS.none) + '.');
  }

  function reset() {
    var before = clone(raw);
    var next = stateLib.defaults();
    next.tab = raw.tab;
    replaceState(next);
    undoState = before;
    showUndo();
    scheduleHash();
    status('Reset to the defaults.');
  }

  // ---- Copy, download, print (SPEC 3.7) -----------------------------------------------------

  function selectField(el) {
    if (!el) return;
    var d = el.closest ? el.closest('details') : null;
    if (d) d.open = true;
    el.focus();
    if (typeof el.select === 'function') el.select();
  }

  function copyText(text, fieldId) {
    var el = $(fieldId);
    function fallback() {
      var ok = false;
      try { selectField(el); ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (ok) status(MSG.copied);
      else { status(MSG.copyFail); selectField(el); }
    }
    if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
      var p;
      try { p = navigator.clipboard.writeText(text); } catch (e) { fallback(); return; }
      p.then(function () { status(MSG.copied); }, guard(fallback));
    } else {
      fallback();
    }
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    status('Downloaded ' + name + '.');
  }

  // ---- Events -------------------------------------------------------------------------------

  function focusField(id) {
    var el = $(id);
    if (!el) return;
    var d = el.closest ? el.closest('details') : null;
    if (d) d.open = true;
    el.focus();
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var b = t.closest('button, a');
    if (!b) return;
    var id = b.id;
    if (id === 'ec-skip') { e.preventDefault(); var main = $('ec-main'); if (main) main.focus(); return; }
    if (b.getAttribute('role') === 'tab') { selectTab(id.replace('ec-tab-', ''), { user: true }); return; }
    if (b.classList.contains('ec-guide-start')) { markHelpSeen(); selectTab('plan', { user: true, focus: true }); return; }
    if (b.hasAttribute('data-example')) { loadExample(b.getAttribute('data-example')); return; }
    if (b.hasAttribute('data-term')) {
      selectTab('guide');
      var dt = $('ec-g-' + b.getAttribute('data-term'));
      if (dt) dt.focus();
      return;
    }
    if (b.hasAttribute('data-focus')) { focusField(b.getAttribute('data-focus')); return; }
    if (b.hasAttribute('data-remove')) { removeGuardrail(b.getAttribute('data-remove')); return; }
    switch (id) {
      case 'ec-example-load': loadExample(readField('ec-example-select')); break;
      case 'ec-reset': reset(); break;
      case 'ec-undo': undo(); break;
      case 'ec-newhere-open': markHelpSeen(); selectTab('guide', { focus: true }); break;
      case 'ec-newhere-dismiss': markHelpSeen(); var m = $('ec-main'); if (m) m.focus(); break;
      case 'ec-plan-guardrail-add': addGuardrail(); break;
      case 'ec-plan-errors-jump': focusField('ec-plan-summary-errors'); break;
      case 'ec-ro-errors-jump': focusField('ec-ro-summary-errors'); break;
      case 'ec-ro-edit-plan': case 'ec-ro-goto-plan': selectTab('plan', { user: true, focus: true }); break;
      case 'ec-prereg-copy': copyText(current.preregMd, 'ec-prereg-md'); break;
      case 'ec-prereg-download': if (current.preregMd) download(current.preregName, current.preregMd); break;
      case 'ec-memo-copy': if (current.memoMd) copyText(current.memoMd, 'ec-memo-md'); break;
      case 'ec-memo-download': if (current.memoMd) download(current.memoName, current.memoMd); break;
      case 'ec-memo-print': window.print(); break;
      case 'ec-share-copy': copyText(readField('ec-share-url'), 'ec-share-url'); break;
      default: break;
    }
  }

  // ---- Startup (SPEC 2.4 step 5, 3.3) -------------------------------------------------------

  function populateExamples() {
    var sel = $('ec-example-select');
    if (!sel) return;
    clear(sel);
    scenarios.list.forEach(function (sc) {
      var opt = make('option', sc.title);
      opt.value = sc.id;
      sel.appendChild(opt);
    });
  }

  function init() {
    populateExamples();
    document.addEventListener('input', guard(onInput));
    document.addEventListener('change', guard(onInput));
    document.addEventListener('click', guard(onClick));
    var tablist = $('ec-tablist');
    if (tablist) tablist.addEventListener('keydown', guard(onTabKey));
    window.addEventListener('hashchange', guard(onHashChange));

    var seen = helpSeen();
    var hash = location.hash;
    var tab, msg = '', banner = false;
    var next;
    if (hash && hash !== '#') {
      var d = stateLib.decode(hash);
      if (d.ok) { next = d.state; tab = next.tab; banner = !seen; }
      else { next = stateLib.defaults(); tab = 'plan'; msg = MSG.badStart; banner = !seen; }
    } else {
      next = stateLib.defaults();
      tab = seen ? 'plan' : 'guide';
    }
    next.tab = tab;
    replaceState(next);
    setHidden('ec-newhere', !banner);
    writeHash();
    if (msg) status(msg);
  }

  try { init(); } catch (err) { warn(err); }
})(typeof self !== 'undefined' ? self : this);
