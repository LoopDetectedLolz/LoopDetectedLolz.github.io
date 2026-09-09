/* Network Field Notes. Only opacity and transform are animated. */
(function () {
  var KEY = 'nfn:origin';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  /* header tightens past 12px */
  var hdr = $('.hdr');
  if (hdr) {
    var onScroll = function () { hdr.classList.toggle('scrolled', (window.scrollY || 0) > 12); };
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* entrance, staggered 60ms, capped at 340ms */
  $$('[data-rise]').forEach(function (el, i) {
    el.style.animationDelay = Math.min(i * 60, 340) + 'ms';
    el.classList.add('rise');
  });

  /* remember where a card or mascot was tapped, in page coordinates */
  $$('[data-origin]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      try {
        sessionStorage.setItem(KEY, JSON.stringify({
          x: r.left + r.width / 2 + window.scrollX, y: r.top + r.height / 2 + window.scrollY,
          kind: e.currentTarget.getAttribute('data-origin') || 'zoom'
        }));
      } catch (err) {}
    });
  });

  /* incoming view: pin transform-origin to the tapped point */
  var view = $('[data-view]');
  if (view) {
    var saved = null;
    try { var raw = sessionStorage.getItem(KEY); if (raw) { saved = JSON.parse(raw); sessionStorage.removeItem(KEY); } } catch (err) {}
    var wants = view.getAttribute('data-view');
    var cls = wants === 'genie' ? 'genie' : wants === 'zoom' ? 'zoom' : 'pop';
    if (saved && saved.kind === wants) {
      var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
      var box = view.getBoundingClientRect();
      view.style.transformOrigin = clamp(saved.x - (box.left + window.scrollX), 0, box.width) + 'px ' +
                                   clamp(saved.y - (box.top + window.scrollY), 0, box.height) + 'px';
    }
    view.classList.add(cls);
  }

  /* index only: category filter + search */
  var grid = $('#posts');
  if (!grid) return;
  var cards = $$('.card[data-cat]', grid), chips = $$('.chip[data-cat]'), empty = $('.empty');
  var input = $('#q'), box = $('.search'), toggle = $('#search-toggle');
  var cat = 'all', q = '';

  function apply() {
    var shown = 0;
    cards.forEach(function (c) {
      var okCat = cat === 'all' || c.getAttribute('data-cat') === cat;
      var okQ = !q || (c.getAttribute('data-text') || '').indexOf(q) !== -1;
      var on = okCat && okQ; c.classList.toggle('hidden', !on); if (on) shown++;
    });
    chips.forEach(function (ch) { ch.classList.toggle('on', ch.getAttribute('data-cat') === cat); });
    if (empty) empty.classList.toggle('show', shown === 0);
  }
  chips.forEach(function (ch) { ch.addEventListener('click', function () { cat = ch.getAttribute('data-cat'); apply(); }); });
  if (toggle && box && input) {
    toggle.addEventListener('click', function (e) {
      e.preventDefault(); box.classList.toggle('open');
      if (box.classList.contains('open')) input.focus();
    });
    input.addEventListener('input', function () { q = input.value.trim().toLowerCase(); apply(); });
  }
  /* deep link: index.html#cat=NAC */
  var m = (location.hash || '').match(/cat=([^&]+)/);
  if (m) { cat = decodeURIComponent(m[1]); }
  apply();
})();
