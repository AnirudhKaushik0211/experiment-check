/* ExperimentCheck scenarios: the six synthetic demo experiments (SPEC 8.4).
 * All names and numbers are invented. Each state is a complete raw state (SPEC 7.1) with tab 'readout'. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.ExperimentCheck = root.ExperimentCheck || {}; root.ExperimentCheck.scenarios = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  var PAGE_LOAD = 'Page load time (ms)';

  // Shared plan P14 with the given text fields and guardrails.
  function planP14(name, metricName, hypothesis, guardrails) {
    return {
      name: name, metricName: metricName, type: 'binary', direction: 'increase',
      baselineRate: '10', baselineMean: '', baselineSd: '',
      mdeType: 'relative', mde: '10', alpha: '5', power: '80', sides: 'two',
      share: '50', daily: '2200', start: '2025-03-03', hypothesis: hypothesis, notes: '',
      guardrails: guardrails
    };
  }

  function guardrail(id, name, type, margin) {
    return { id: id, name: name, type: type, direction: 'decrease', margin: margin };
  }

  function binArm(n, x) { return { n: String(n), x: String(x), mean: '', sd: '' }; }
  function contArm(n, mean, sd) { return { n: String(n), x: '', mean: String(mean), sd: String(sd) }; }

  function readout(c, t, through, looks, guardrails) {
    return {
      control: c, treatment: t, through: through, looks: looks || '1', srmThreshold: '0.001',
      guardrails: guardrails
    };
  }

  // Page-load guardrail readout: n per arm, control/treatment means, sd 400.
  function pageLoad(nc, nt, mc, mt) {
    return { control: contArm(nc, mc, 400), treatment: contArm(nt, mt, 400) };
  }

  function state(plan, ro) { return { v: 1, tab: 'readout', plan: plan, readout: ro }; }

  var list = [
    {
      id: 'clean-win',
      title: 'Clean win',
      description: 'Significant lift above the MDE, clean checks.',
      expected: { verdict: 'ship', decisive: 'ship-meaningful' },
      state: state(
        planP14('New checkout button copy', 'Checkout conversion',
          "Changing the checkout button label from 'Continue' to 'Pay securely' raises checkout conversion because it reduces uncertainty at the last step.",
          [guardrail('g1', PAGE_LOAD, 'continuous', '5')]),
        readout(binArm(15400, 1540), binArm(15380, 1754), '2025-03-16', '1',
          { g1: pageLoad(15400, 15380, 1200, 1205) }))
    },
    {
      id: 'flat',
      title: 'Flat / inconclusive',
      description: 'Ran to plan, not significant, and the interval still includes the MDE.',
      expected: { verdict: 'inconclusive', decisive: 'underpowered' },
      state: state(
        planP14('Simplified pricing page', 'Plan sign-up rate',
          'A shorter pricing page with three plans instead of five raises plan sign-ups.',
          [guardrail('g1', PAGE_LOAD, 'continuous', '5')]),
        readout(binArm(15350, 1535), binArm(15420, 1611), '2025-03-16', '1',
          { g1: pageLoad(15350, 15420, 1200, 1203) }))
    },
    {
      id: 'srm',
      title: 'Sample ratio mismatch',
      description: 'Treatment has 900 fewer users than control under a 50/50 split.',
      expected: { verdict: 'investigate', decisive: 'srm' },
      state: state(
        planP14('Personalised homepage banner', 'Click-through to product',
          'A banner personalised to recent browsing raises click-through to product pages.',
          [guardrail('g1', PAGE_LOAD, 'continuous', '5')]),
        readout(binArm(15800, 1580), binArm(14900, 1702), '2025-03-16', '1',
          { g1: pageLoad(15800, 14900, 1200, 1210) }))
    },
    {
      id: 'peeking',
      title: 'Peeking too early',
      description: 'Analysed on day 5 of 14 after three looks.',
      expected: { verdict: 'inconclusive', decisive: 'early' },
      state: state(
        planP14('Free-shipping threshold banner', 'Order conversion',
          'Showing how close the cart is to free shipping raises order conversion.',
          [guardrail('g1', PAGE_LOAD, 'continuous', '5')]),
        readout(binArm(5500, 550), binArm(5510, 632), '2025-03-07', '3',
          { g1: pageLoad(5500, 5510, 1200, 1204) }))
    },
    {
      id: 'trivial',
      title: 'Significant but trivial',
      description: 'Huge sample, significant, but the whole interval is below the MDE.',
      expected: { verdict: 'dont-ship', decisive: 'trivial' },
      state: state(
        {
          name: 'Larger search result thumbnails', metricName: 'Search-to-purchase rate', type: 'binary', direction: 'increase',
          baselineRate: '10', baselineMean: '', baselineSd: '',
          mdeType: 'relative', mde: '5', alpha: '5', power: '80', sides: 'two',
          share: '50', daily: '60000', start: '2025-03-03',
          hypothesis: 'Larger thumbnails on search results raise search-to-purchase conversion.', notes: '',
          guardrails: [guardrail('g1', PAGE_LOAD, 'continuous', '5')]
        },
        readout(binArm(210000, 21000), binArm(210200, 21546), '2025-03-09', '1',
          { g1: pageLoad(210000, 210200, 1200, 1202) }))
    },
    {
      id: 'guardrail-breach',
      title: 'Guardrail breach',
      description: 'Conversion is up, but refunds rose by more than the limit.',
      expected: { verdict: 'dont-ship', decisive: 'guardrail-breach' },
      state: state(
        planP14('Express checkout button', 'Checkout conversion',
          'A one-tap express checkout button raises checkout conversion by skipping the address and payment steps for returning users.',
          [guardrail('g1', 'Refund rate', 'binary', '10'), guardrail('g2', PAGE_LOAD, 'continuous', '5')]),
        readout(binArm(15400, 1540), binArm(15380, 1754), '2025-03-16', '1', {
          g1: { control: binArm(15400, 300), treatment: binArm(15380, 372) },
          g2: pageLoad(15400, 15380, 1200, 1205)
        }))
    }
  ];

  return { list: list };
});
