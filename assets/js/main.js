/* 李昌昊作品集 · 公共脚本：导航、开场、滚动渐显、卡片悬停标签、作品筛选 */
(function () {
  var d = document, root = d.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 导航：滚动后显示底线
  var header = d.querySelector('.site-header');
  function onScroll() { if (header) header.classList.toggle('scrolled', window.scrollY > 8); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // 手机菜单
  var btn = d.querySelector('.menu-btn'), nav = d.getElementById('site-nav');
  if (btn && nav) {
    var label = btn.querySelector('.menu-label');
    var setMenu = function (open) {
      btn.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
      if (label) label.textContent = open ? '关闭' : '菜单';
    };
    btn.addEventListener('click', function () { setMenu(btn.getAttribute('aria-expanded') !== 'true'); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { setMenu(false); btn.focus(); }
    });
    window.addEventListener('resize', function () { if (window.innerWidth > 720) setMenu(false); });
  }

  // 开场：1.5 秒后淡出；Esc 或点击跳过；同一会话只出现一次（是否显示由 <head> 里的内联脚本决定）
  var intro = d.getElementById('intro');
  if (intro && root.classList.contains('show-intro')) {
    try { sessionStorage.setItem('lch-intro', '1'); } catch (e) {}
    var gone = false;
    var onKey = function (e) { if (e.key === 'Escape') hide(); };
    var hide = function () {
      if (gone) return;
      gone = true;
      intro.classList.add('done');
      d.removeEventListener('keydown', onKey);
      setTimeout(function () { root.classList.remove('show-intro'); }, 560);
    };
    d.addEventListener('keydown', onKey);
    intro.addEventListener('click', hide);
    setTimeout(hide, 1500);
  }

  // 滚动渐显
  var els = d.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // 卡片图片上的“查看”标签跟随鼠标
  d.querySelectorAll('[data-view]').forEach(function (m) {
    m.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = m.getBoundingClientRect();
      m.style.setProperty('--x', (e.clientX - r.left) + 'px');
      m.style.setProperty('--y', (e.clientY - r.top) + 'px');
    });
    m.addEventListener('pointerleave', function () { m.style.removeProperty('--x'); m.style.removeProperty('--y'); });
  });

  // 作品页分类筛选
  var filters = d.querySelectorAll('[data-filter]');
  if (filters.length) {
    var items = d.querySelectorAll('[data-cat]');
    var count = d.getElementById('work-count');
    var apply = function (cat) {
      var n = 0;
      filters.forEach(function (f) { f.setAttribute('aria-pressed', String(f.dataset.filter === cat)); });
      items.forEach(function (it) {
        var show = cat === 'all' || it.dataset.cat.split(' ').indexOf(cat) > -1;
        it.hidden = !show;
        if (show) n++;
      });
      if (count) count.textContent = n;
    };
    filters.forEach(function (f) { f.addEventListener('click', function () { apply(f.dataset.filter); }); });
    var start = (location.hash || '').slice(1);
    apply(d.querySelector('[data-filter="' + start + '"]') ? start : 'all');
  }
})();
