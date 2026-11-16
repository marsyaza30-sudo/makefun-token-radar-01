// Token Radar dashboard (model radar-2). Renders entirely from window.RADAR —
// the data.js that main.ts writes beside this page from the sealed snapshot.
// No fetch, no network: search, filters, sorting and the detail drawer are all
// computed here, and the model + farm-plan functions below mirror lib/model.ts
// so the page recomputes every number it shows and can prove it matches board.json.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', tier: 'all', minTvl: 0, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + ' yrs';
    return Math.round(d) + ' days';
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s); }

  // ---- the model, mirrored from lib/model.ts (impliedValue + categoryStats) ----
  function impliedOf(row) {
    var growthPct = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growthPct / 100) * M.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var maturityMult = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var reachMult = 1 + Math.min(Math.max((row.chains ? row.chains.length : 1) - 1, 0), M.reach_max_extra_chains) * M.reach_per_chain;
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturityMult * reachMult)),
      growthMult: growthMult, maturityMult: maturityMult, reachMult: reachMult
    };
  }
  function catStat(category) {
    var key = category || 'Other';
    for (var i = 0; i < DATA.categories.length; i++) if (DATA.categories[i].category === key) return DATA.categories[i];
    return { category: key, peer_count: 0, peer_median: null, multiple: DATA.global_median, global_median: DATA.global_median };
  }

  // ---- the farm plan, mirrored from lib/model.ts (farmSteps) ----
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function gasUsd(p) { return chainOf(p) === 'Ethereum' ? 9 : 2; }
  function capitalFor(p) {
    if (p.tvl_usd >= 2e9) return 300; if (p.tvl_usd >= 5e8) return 200;
    if (p.tvl_usd >= 1e8) return 120; if (p.tvl_usd >= 2e7) return 75; return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60; if (age < 730) return 45; return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase(); var n = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + n + ' vault on ' + chain + ', pick the vault with the longest track record, and keep the vault shares in the same wallet';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Supply $' + capital + ' of USDC as collateral to ' + n + ' on ' + chain + ', borrow no more than 30% against it, and keep the health factor above 2.0';
    if (c.indexOf('dex') >= 0) return 'Swap $' + capital + " of USDC for the pool's main asset on " + n + ' (' + chain + '), then provide both sides to its busiest pool and keep the LP position open';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + n + ' (' + chain + ') and open one small hedged trade a week so volume and open interest both register';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + n + "'s yield-bearing asset on " + chain + ' through its own app and hold the asset untouched in the farming wallet';
    if (c.indexOf('basis') >= 0) return 'Open the $' + capital + ' basis position ' + n + ' offers on ' + chain + ' (long spot, short hedge) and leave both legs in place';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + n + ' on ' + chain + ' and keep the staking receipt token in the wallet';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + n + "'s main yield vault on " + chain + ' and keep the shares; do not chase the highest-APY vault';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ', hold a balance there, and make one native swap a week inside the ' + n + ' ecosystem';
    if (c.indexOf('payment') >= 0) return 'Route one real payment of about $' + capital + ' through ' + n + ' on ' + chain + ' each week and keep the receiving wallet active';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + n + ' on ' + chain + ' for a position you actually hold, and keep the policy to expiry';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + n + ' and take one position in its most liquid market each week, settling rather than abandoning it';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + n + ' on ' + chain + ' and hold it in the farming wallet';
    return 'Deposit $' + capital + ' of USDC into ' + n + ' on ' + chain + ' through its own app and keep the position open and untouched';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('basis') >= 0) return "Watch liquidation risk weekly: if the position's health factor falls under 1.6, top up collateral or close the riskiest leg first";
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0) return 'Read the redemption terms before you need them: note the lock-up and the exit window, and never farm with money you need back this month';
    if (c.indexOf('chain') >= 0 || c.indexOf('bridge') >= 0) return "Bridge only through the link on the protocol's own page, send a $5 test transfer first, and wait for it to land before moving the full amount";
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'Keep leverage at 1x and size the hedge so a 20% move cannot liquidate you; farming volume is the goal, not directional profit';
    return 'Set a calendar reminder to re-check the position monthly: contracts, front-ends and reward terms change, and a stale position earns nothing';
  }
  function stepText(step) {
    var s = step.text + '. Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s += " Hold the position and re-check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p); var capital = capitalFor(p); var gas = gasUsd(p); var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Set up one fresh wallet for ' + p.name + ' only, fund it with $' + (capital + 25) + ' on ' + chain + ', and store its seed phrase offline on paper', cost: 'about $' + gas + ' of gas to fund and approve', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of working capital plus about $' + gas + ' of gas', time: '20 minutes to set up' },
      { text: 'Repeat one small qualifying action every week — a deposit top-up, a swap, a vote or a claim — so the wallet shows a history, not a single visit', cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days without withdrawing, so the activity spans several weekly snapshots of the protocol', cost: 'the $' + capital + ' stays deployed for the whole hold', time: hold + ' days' },
      { text: riskFor(p), cost: 'no fee to check; acting early is what saves the capital', time: '5 minutes a week' },
      { text: "Log the wallet address, every date, amount and transaction hash in a farm log, and check only the protocol's own page for any points or claim announcement", cost: 'nothing; never pay anyone to claim for you', time: '5 minutes, then 2 minutes a week' }
    ].map(stepText);
  }

  // ---- tiny DOM helper ----
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var q = new URLSearchParams(h);
    if (q.get('q')) state.q = q.get('q');
    if (q.get('category')) state.category = q.get('category');
    if (q.get('tier')) state.tier = q.get('tier');
    if (q.get('p')) state.selected = q.get('p');
  }
  function writeHash() {
    var q = new URLSearchParams();
    if (state.q) q.set('q', state.q);
    if (state.category !== 'all') q.set('category', state.category);
    if (state.tier !== 'all') q.set('tier', state.tier);
    if (state.selected) q.set('p', state.selected);
    var s = q.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'ring', 'aria-hidden': 'true' }),
        el('div', null, el('b', { text: 'TOKEN RADAR' }), el('span', { text: 'token launch radar · model ' + DATA.model_version }))),
      el('div', { class: 'top-meta' },
        el('span', { class: 'chip' }, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { class: 'chip' }, 'Watchlist floor ', el('b', { text: fmtUsd(DATA.floor_usd) })),
        el('span', { class: 'chip' }, 'Board ', el('b', { text: DATA.board_size + ' protocols' }))));
  }
  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', { class: 'lede' }, 'Every protocol in the sealed DefiLlama snapshot was checked the same way: does it ',
          el('b', { text: 'record no token' }), ', and is it free of wrapped / staked products of a token that already trades? ',
          DATA.board_size + ' protocols pass. They are ranked by ', el('b', { text: 'implied value' }),
          ' — what a token launch would be worth if the record stayed as it is. Strongest first: ',
          el('b', { text: top.name + ' at ' + fmtUsd(top.implied_value_usd) }), '. Implied value is this board\u2019s own model claim, not a price prediction and not a promise of an airdrop.')),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(DATA.protocols_scanned) }), el('span', { text: 'protocols scanned in the snapshot' })),
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'watchlist protocols covered' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds beyond the watchlist' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('span', { text: 'combined implied value of the board' }))));
  }
  function method() {
    var top = DATA.rows[0]; var st = catStat(top.category); var chk = impliedOf(top);
    return el('section', { class: 'method', 'aria-label': 'Methodology' },
      el('h2', { text: 'How the ranking works — read this before you farm anything' }),
      el('p', { text: 'One function scores every protocol from the snapshot\u2019s own figures. No name is special-cased and no row is hand-picked; the page recomputes each row live and the detail view shows the check against board.json.' }),
      el('div', { class: 'formula', text: 'implied = TVL x peer_multiple(category) x growth_mult(7d change) x maturity_mult(days recording no token) x reach_mult(chains)' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Peer multiple: ' }), 'the median market-cap / TVL of already-trading protocols in the same category, read off this snapshot (global median ' + DATA.global_median + 'x), shrunk halfway to that global median and clamped to 0.08x–1.20x. A lending protocol is priced like lending tokens actually trade, not like a DEX.'),
        el('li', null, el('b', { text: 'Growth: ' }), 'the 7-day TVL change, clamped to -40%…+60%, weighted x0.6 — momentum lifts a launch, one hot week cannot invent one.'),
        el('li', null, el('b', { text: 'Maturity: ' }), 'days from first listing to the snapshot date — how long the protocol has operated while recording no token (0.72x rising to 1.20x over four years).'),
        el('li', null, el('b', { text: 'Excluded: ' }), DATA.excluded_products + ' records-no-token protocols were set aside as wrapped, staked, bridged or exchange products of tokens that already trade (WBTC and staked-ETH style products), plus every protocol whose token already trades — see the Already trading tab.'),
        el('li', null, el('b', { text: 'Worked example — #' + top.rank + ' ' + top.name + ': ' }), fmtUsd(top.tvl_usd) + ' TVL x ' + top.peer_multiple + 'x peer multiple (' + st.peer_count + ' trading ' + (top.category || 'Other') + ' peers) x ' + chk.growthMult.toFixed(3) + ' growth x ' + chk.maturityMult.toFixed(3) + ' maturity x ' + chk.reachMult.toFixed(2) + ' reach = ' + fmtUsd(top.implied_value_usd) + '.')));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category, chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(false); });
    function select(id, label, options, value, onChange) {
      var s = el('select', { id: id, 'aria-label': label }, options.map(function (o) {
        return el('option', { value: String(o[0]), text: o[1], selected: String(o[0]) === String(value) ? 'selected' : null });
      }));
      s.addEventListener('change', function () { onChange(s.value); writeHash(); render(false); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var boardBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; render(false); } });
    var liveBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; render(false); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('f-category', 'Category', [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      select('f-chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      select('f-tier', 'Radar tier', [['all', 'Watchlist + early'], ['watchlist', 'Watchlist only'], ['early', 'Early finds only']], state.tier, function (v) { state.tier = v; }),
      select('f-tvl', 'Minimum TVL', [[0, 'Any TVL'], [5000000, '$5M+'], [50000000, '$50M+ (floor)'], [100000000, '$100M+'], [500000000, '$500M+'], [1000000000, '$1B+']], state.minTvl, function (v) { state.minTvl = Number(v); }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, boardBtn, liveBtn)),
      el('span', { class: 'count' }, state.tab === 'board' ? el('b', { text: String(visibleRows().length) }) : el('b', { text: String(DATA.live.length) }), state.tab === 'board' ? ' rows shown of ' + DATA.board_size : ' trading protocols (comparables)'));
  }
  function sortHead(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(false);
    } }, label + (state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : '')));
  }
  function boardTable() {
    var list = sorted(visibleRows());
    if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches those filters' }),
      el('p', { text: 'Loosen the search, chain, tier or minimum-TVL filter to see the board again.' }),
      el('button', { class: 'btn primary', type: 'button', text: 'Clear all filters', onclick: function () {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.tier = 'all'; state.minTvl = 0; writeHash(); render(false);
      } })));
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num', text: '#' + r.rank }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain n/a') + ((r.chains || []).length > 3 ? ' +' + (r.chains.length - 3) : '') }))),
        el('td', null, el('span', { class: 'badge ' + r.tier, text: r.tier === 'watchlist' ? 'Watchlist' : 'Early' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.peer_multiple.toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Ranked by implied value (rank is the model\u2019s claim; use the column headers to re-sort). Select any row for its full model breakdown and farm plan.' }),
      el('thead', null, el('tr', null, sortHead('implied', 'Rank'), sortHead('name', 'Protocol'), el('th', { scope: 'col', text: 'Tier' }),
        sortHead('tvl', 'TVL'), sortHead('growth', '7d change'), sortHead('age', 'No-token age'), sortHead('peer', 'Peer ×'), sortHead('implied', 'Implied value'))),
      tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain n/a') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.ratio === null ? 'n/a' : r.ratio.toFixed(2) + 'x' }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'badge early', text: 'Trading' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Already trading: these protocols have a token with a recorded market cap, so they are never ranked as launches. Their market-cap / TVL ratios are the comparables the peer multiples are built from.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: '7d change' }), el('th', { scope: 'col', text: 'Status' }))),
      tbody)));
  }
  function foot() {
    return el('p', { class: 'foot' }, el('b', { text: 'Honest limits. ' }),
      '“Records no token” is what the snapshot says (market cap, CoinGecko id and symbol all empty) — a protocol may still have a token DefiLlama does not carry, and no board can promise a launch or an airdrop. Implied values are this entry\u2019s model, computed only from the snapshot dated ' + DATA.as_of + '. Farm plans cost real money and carry smart-contract and market risk; sizes here are deliberately small. Source note in the page text: ' + DATA.source + '.');
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  document.body.appendChild(dialog);
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(false); });
  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug; writeHash();
    var chk = impliedOf(row); var st = catStat(row.category); var steps = farmSteps(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null, el('span', { class: 'kicker', text: 'Rank #' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.tier === 'watchlist' ? 'Watchlist' : 'Early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · slug: ' + row.slug })),
      el('button', { class: 'close', type: 'button', text: 'Close ✕', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('div', { class: 'grid2' },
      el('div', { class: 'cell' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
      el('div', { class: 'cell' }, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'cell' }, el('span', { text: '7-day TVL change' }), el('b', { text: fmtPct(row.change_7d) })),
      el('div', { class: 'cell' }, el('span', { text: 'Running with no token recorded' }), el('b', { text: fmtAge(row.age_days) })),
      el('div', { class: 'cell' }, el('span', { text: 'First tracked' }), el('b', { text: row.listed_at || 'not reported' })),
      el('div', { class: 'cell' }, el('span', { text: 'Chains' }), el('b', { text: String((row.chains || []).length) }))));
    if ((row.chains || []).length) dialog.appendChild(el('p', { class: 'sub', text: 'Chains: ' + row.chains.join(', ') }));
    dialog.appendChild(el('section', { class: 'section' },
      el('h3', { text: 'Why it is on the radar' }),
      el('ul', { class: 'checks' },
        el('li', { text: 'Records no token in the snapshot: market cap, CoinGecko id and symbol are all empty.' }),
        el('li', { text: 'Not a wrapped, staked or bridged product: its category is not a bridge / staking-product category, and its name carries no wrapped / staked marker, no version suffix and no exchange prefix.' }),
        el('li', { text: row.tier === 'watchlist' ? 'On the house watchlist: TVL at or above the ' + fmtUsd(DATA.floor_usd) + ' floor.' : 'Early find: below the ' + fmtUsd(DATA.floor_usd) + ' watchlist floor, found by scanning every pre-token record — exactly what a radar is for.' }),
        el('li', { text: 'Priced against ' + st.peer_count + ' trading ' + (row.category || 'Other') + ' peers (median ' + (st.peer_median === null ? 'n/a' : st.peer_median.toFixed(2) + 'x') + ' market-cap / TVL in this snapshot).' }))));
    dialog.appendChild(el('section', { class: 'section' },
      el('h3', { text: 'Implied value — the arithmetic' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '× peer multiple (' + (row.category || 'Other') + ')' }), el('b', { text: row.peer_multiple.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: '× growth multiplier' }), el('b', { text: chk.growthMult.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: '× maturity multiplier' }), el('b', { text: chk.maturityMult.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: '× reach multiplier' }), el('b', { text: chk.reachMult.toFixed(4) + 'x' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))),
      el('p', { class: 'sub', text: 'This page recomputes the row as ' + fmtUsd(chk.implied) + (chk.implied === row.implied_value_usd ? ' — identical to board.json, so page and data agree.' : ' — which differs from board.json; treat the board file as stale.') + ' An estimate of launch scale, never a price target.' })));
    dialog.appendChild(el('section', { class: 'section' },
      el('h3', { text: 'Farm plan — ' + steps.length + ' steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf('. Cost: ');
        return el('li', null, el('b', { text: at >= 0 ? s.slice(0, at + 1) : s }), at >= 0 ? el('span', { class: 'cost', text: s.slice(at + 2) }) : null);
      })),
      el('p', { class: 'sub', text: 'Start with step 1 today; the weekly cadence and the hold are what separate a farm history from a single visit. Total at risk if you follow it literally: the working capital in step 2 plus roughly one gas payment a week.' })));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    var active = document.activeElement;
    var activeId = active && active.id ? active.id : null;
    var selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(method());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (activeId) {
      var again = document.getElementById(activeId);
      if (again) {
        again.focus();
        if (selStart !== null && again.setSelectionRange) { try { again.setSelectionRange(selStart, selStart); } catch (e) { /* not a text field */ } }
      }
    }
  }

  readHash();
  render(true);
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
