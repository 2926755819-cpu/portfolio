/* 首页玻璃环：作品卡片绕着人像慢慢转。
   - 鼠标停在卡片上、键盘选中卡片、点“暂停”按钮时停下；键盘选中的卡片会转到正前方
   - 左右拖动可以手动转，松手后带一点惯性
   - 系统设置了“减少动态效果”时不自动转
   - 转到身后的卡片用人像剪影遮住，看起来是从身后绕过去
   配置由 tools/make_orbit.py 写在 <svg data-orbit> 上。 */
(function () {
  'use strict';
  var svgs = document.querySelectorAll('svg[data-orbit]');
  if (!svgs.length) return;
  var NS = 'http://www.w3.org/2000/svg';
  var RAD = Math.PI / 180;
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var shared = { userPaused: false, orbits: [] };

  function emWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); w += c > 0x2e80 ? 1 : c === 32 ? .32 : .58; }
    return w;
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function Orbit(svg) {
    var c = JSON.parse(svg.getAttribute('data-orbit'));
    var cx = c.cx, cy = c.cy, rx = c.rx, ry = c.ry, sid = c.id, half = c.span / 2;
    var n = c.cards.length, gap = 360 / n - c.span;
    var X = function (t) { return cx + rx * Math.cos(t * RAD); };
    var Y = function (t) { return cy + ry * Math.sin(t * RAD); };
    var S = function (t) { return .86 + .14 * Math.sin(t * RAD); };   // 近大远小
    var P = function (x, y) { return r1(x) + ' ' + r1(y); };
    var lerp = function (a, b, m) { var o = []; for (var i = 0; i <= m; i++) o.push(a + (b - a) * i / m); return o; };
    var step = function (t, toward, px) {   // 沿环线从 t 往 toward 走 px 像素后的角度
      var v = Math.hypot(rx * Math.sin(t * RAD), ry * Math.cos(t * RAD)) * RAD;
      var d = px / Math.max(v, .05);
      return toward > t ? t + d : t - d;
    };
    var arc = function (a, b, k, m) {         // 环线向下偏移 k；返回路径和长度
      var ts = lerp(a, b, m || 16), d = '', len = 0, px, py;
      for (var i = 0; i < ts.length; i++) {
        var x = X(ts[i]), y = Y(ts[i]) + k * S(ts[i]);
        d += (i ? ' L' : 'M') + P(x, y);
        if (i) len += Math.hypot(x - px, y - py);
        px = x; py = y;
      }
      return { d: d, len: len };
    };
    var panel = function (a, b, k1, k2, r) {  // 圆角弯曲面板，a、b 是屏幕上左、右两端的角度
      var top = function (t) { return Y(t) + k1 * S(t); };
      var bot = function (t) { return Y(t) + k2 * S(t); };
      var w = Math.abs(X(a) - X(b));
      r = Math.max(0, Math.min(r, w / 2 - .5, (k2 - k1) * S((a + b) / 2) / 2));
      var a1 = step(a, b, r), b1 = step(b, a, r);
      var d = 'M' + lerp(a1, b1, 14).map(function (t) { return P(X(t), top(t)); }).join(' L');
      d += ' Q' + P(X(b), top(b)) + ' ' + P(X(b), top(b) + r) + ' L' + P(X(b), bot(b) - r) + ' Q' + P(X(b), bot(b)) + ' ' + P(X(b1), bot(b1));
      d += ' L' + lerp(b1, a1, 14).map(function (t) { return P(X(t), bot(t)); }).join(' L');
      d += ' Q' + P(X(a), bot(a)) + ' ' + P(X(a), bot(a) - r) + ' L' + P(X(a), top(a) + r) + ' Q' + P(X(a), top(a)) + ' ' + P(X(a1), top(a1)) + 'Z';
      return d;
    };

    // ---------- 建立卡片 ----------
    var defs = svg.querySelector('defs'), layer = svg.querySelector('.cards');
    var ringB = svg.querySelector('.rings-b'), ringF = svg.querySelector('.rings-f');
    var dotsB = svg.querySelector('.dots-b'), dotsF = svg.querySelector('.dots-f');
    var dots = [];
    for (var i = 0; i < n; i++) dots.push([el('circle', { class: 'node', r: 2.4 }, dotsB), el('circle', { class: 'node', r: 2.4 }, dotsF)]);
    var unrot = 'rotate(' + -c.tilt + ' ' + cx + ' ' + cy + ')';
    var STRIPS = 16, INSET = 6, capH = c.caps ? 22 : INSET;

    var cards = c.cards.map(function (d, k) {
      var o = { d: d, base: 90 - 360 / n * k, front: null, h0: d.kind === 'img' ? c.img_h0 : c.h0 };
      var id = sid + '-' + k;
      o.clip = el('path', {}, el('clipPath', { id: id + 'c' }, defs));
      o.a = el('a', { class: 'oc', href: d.href, 'aria-label': d.aria }, layer);
      var lift = el('g', { class: 'lift' }, o.a);
      o.frost = el('image', { href: c.frost.href, x: c.frost.x, y: c.frost.y, width: c.frost.w, height: c.frost.h, transform: unrot },
                   el('g', { 'clip-path': 'url(#' + id + 'c)' }, lift));
      o.edge = el('path', { class: 'glass-edge' }, lift);   // 细描边代替投影：投影每帧重算太慢
      o.glass = el('path', { class: 'glass' }, lift);
      var ct = el('g', { 'clip-path': 'url(#' + id + 'c)' }, lift);
      if (d.kind === 'text') {
        o.chip = el('circle', { fill: d.fill }, ct);
        o.ico = el('g', { color: d.ink }, ct);
        o.ico.innerHTML = d.icon;
        o.tp = el('path', { id: id + 't' }, defs);
        o.tt = el('text', { class: 'oc-t' }, ct);
        el('textPath', { href: '#' + id + 't' }, o.tt).textContent = d.title;
        o.tw = emWidth(d.title);
        if (d.sub) {
          o.sp = el('path', { id: id + 's' }, defs);
          o.st = el('text', { class: 'oc-s' }, ct);
          el('textPath', { href: '#' + id + 's' }, o.st).textContent = d.sub;
          o.sw = emWidth(d.sub);
        }
      } else {
        o.iclip = el('path', {}, el('clipPath', { id: id + 'i' }, defs));
        var g = el('g', { 'clip-path': 'url(#' + id + 'i)' }, ct);
        // 按正前方时的宽高比裁图；转到侧面时图片跟着被压窄，像真的贴在转动的面上
        var wf = 2 * rx * Math.sin(half * RAD) - 2 * INSET, hf = o.h0 - INSET - capH;
        var crop = Math.min(560, 560 * hf / wf);
        o.strips = [];
        for (var s = 0; s < STRIPS; s++) {
          var sv = el('svg', { viewBox: r1(s / STRIPS * 560) + ' ' + r1((560 - crop) / 2) + ' ' + r1(560 / STRIPS) + ' ' + r1(crop), preserveAspectRatio: 'none' }, g);
          el('image', { href: d.img, width: 560, height: 560 }, sv);
          o.strips.push(sv);
        }
        if (c.caps) {
          o.cp = el('path', { id: id + 'p' }, defs);
          o.ctx = el('text', { class: 'oc-c', 'text-anchor': 'middle', 'font-size': c.cap_fs }, ct);
          el('textPath', { href: '#' + id + 'p', startOffset: '50%' }, o.ctx).textContent = d.cap;
        }
      }
      o.a.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { st.hover++; } });
      o.a.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { st.hover = Math.max(0, st.hover - 1); } });
      o.a.addEventListener('focus', function () { st.focus = true; snapTo(k); });
      o.a.addEventListener('blur', function () { st.focus = false; });
      return o;
    });

    // ---------- 每一帧 ----------
    function update(phi) {
      for (var k = 0; k < n; k++) {
        var o = cards[k], d = o.d, m = o.base + phi;
        var mm = ((m % 360) + 360) % 360, front = mm > 0 && mm < 180;
        var t1 = m - half, t2 = m + half, a = front ? t2 : t1, b = front ? t1 : t2, span = b - a;
        var h0 = o.h0, sm = S(m), w = Math.abs(X(t1) - X(t2));
        var outline = panel(a, b, -h0 / 2, h0 / 2, 14 * sm);
        o.clip.setAttribute('d', outline);
        o.glass.setAttribute('d', outline);
        o.edge.setAttribute('d', outline);
        if (front !== o.front) {
          o.front = front;
          o.glass.setAttribute('fill', 'url(#' + sid + (front ? '-gf)' : '-gb)'));
          o.frost.style.display = front ? '' : 'none';
          if (front) o.a.removeAttribute('mask'); else o.a.setAttribute('mask', 'url(#' + sid + '-bh)');
          // 前排的卡片挪到最后画（叠在上层）；正被键盘选中的不挪，免得丢失焦点
          if (document.activeElement !== o.a) {
            if (front) layer.appendChild(o.a); else layer.insertBefore(o.a, layer.firstChild);
          }
        }
        if (d.kind === 'text') {
          var tc = a + span * .14, cr = Math.min(h0 * .25 * S(tc), w * .11), sc = cr * 1.05 / 12;
          o.chip.setAttribute('cx', r1(X(tc))); o.chip.setAttribute('cy', r1(Y(tc))); o.chip.setAttribute('r', r1(cr));
          o.ico.setAttribute('transform', 'translate(' + r1(X(tc) - 12 * sc) + ' ' + r1(Y(tc) - 12 * sc) + ') scale(' + (Math.round(sc * 1000) / 1000) + ')');
          var ts = a + span * .27, te = b - span * .06;
          var pt = arc(ts, te, d.sub ? -.03 * h0 : .36 * c.fs);
          var fs = Math.min(c.fs * sm, pt.len * .96 / o.tw);
          o.tp.setAttribute('d', pt.d);
          o.tt.setAttribute('font-size', r1(fs));
          o.tt.style.opacity = clamp((fs - 6) / 4, 0, 1);
          if (o.sp) {
            var ps = arc(ts, te, .26 * h0), fss = Math.min(c.fs * .7 * sm, ps.len * .96 / o.sw);
            o.sp.setAttribute('d', ps.d);
            o.st.setAttribute('font-size', r1(fss));
            o.st.style.opacity = clamp((fss - 6) / 3, 0, 1);
          }
        } else {
          var ia = step(a, b, INSET), ib = step(b, a, INSET), k1 = -h0 / 2 + INSET, k2 = h0 / 2 - capH;
          o.iclip.setAttribute('d', panel(ia, ib, k1, k2, 9 * sm));
          var tt = lerp(ia, ib, STRIPS);
          for (var s = 0; s < STRIPS; s++) {
            var xa = X(tt[s]), xb = X(tt[s + 1]), tm = (tt[s] + tt[s + 1]) / 2;
            var x0 = Math.min(xa, xb), y0 = Y(tm) + k1 * S(tm), hh = (k2 - k1) * S(tm), sv = o.strips[s];
            sv.setAttribute('x', r1(x0 - .4)); sv.setAttribute('y', r1(y0 - 1));
            sv.setAttribute('width', r1(Math.abs(xb - xa) + .8)); sv.setAttribute('height', r1(hh + 2));
          }
          if (o.cp) {
            o.cp.setAttribute('d', arc(ia, ib, h0 / 2 - 8).d);
            o.ctx.style.opacity = clamp((w - 70) / 40, 0, 1);
          }
        }
      }
      // 环线只画在卡片之间的空隙里；跨过 0° / 180° 的拆开，分别放到人像后面和前面
      var db = '', df = '';
      for (var j = 0; j < n; j++) {
        var g1 = cards[j].base + phi + half, g2 = g1 + gap, cuts = [g1];
        for (var v = Math.ceil(g1 / 180) * 180; v < g2; v += 180) cuts.push(v);
        cuts.push(g2);
        for (var q = 0; q + 1 < cuts.length; q++) {
          var mid = ((((cuts[q] + cuts[q + 1]) / 2) % 360) + 360) % 360, seg = arc(cuts[q] - .5, cuts[q + 1] + .5, 0, 4).d;
          if (mid > 0 && mid < 180) df += seg; else db += seg;
        }
        var dm = g1 + gap / 2, dmm = ((dm % 360) + 360) % 360, isF = dmm > 0 && dmm < 180;
        var dot = dots[j][isF ? 1 : 0], other = dots[j][isF ? 0 : 1];
        dot.setAttribute('cx', r1(X(dm))); dot.setAttribute('cy', r1(Y(dm))); dot.style.display = ''; other.style.display = 'none';
      }
      ringB.setAttribute('d', db || 'M0 0');
      ringF.setAttribute('d', df || 'M0 0');
    }

    // ---------- 转动 ----------
    var st = { hover: 0, focus: false, drag: false };
    var phi = c.phase, vel = 0, last = 0, running = false, snap = null, down = null, moved = false, justDragged = false;
    var hist = [];
    function target() { return st.hover || st.focus || st.drag || shared.userPaused || reduce.matches ? 0 : -c.speed; }
    function snapTo(k) {
      var m = cards[k].base + phi, d = ((90 - m) % 360 + 540) % 360 - 180;
      if (Math.abs(d) < .5) return;
      snap = phi + d;
      if (reduce.matches) { phi = snap; snap = null; update(phi); }
      start();
    }
    function frame(ts) {
      if (!running) return;
      var dt = last ? Math.min((ts - last) / 1000, .05) : 0, changed = false;
      last = ts;
      if (!st.drag) {
        if (snap !== null) {
          phi += (snap - phi) * Math.min(1, dt * 6); vel = 0; changed = true;
          if (Math.abs(snap - phi) < .05) { phi = snap; snap = null; }
        } else {
          vel += (target() - vel) * Math.min(1, dt * 2.5);
          if (Math.abs(vel) > .005) { phi += vel * dt; changed = true; } else vel = 0;
        }
      }
      if (changed) update(phi);
      requestAnimationFrame(frame);
    }
    function start() { if (!running && visible) { running = true; last = 0; requestAnimationFrame(frame); } }
    var visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible) start(); else running = false;
      }).observe(svg);
    }

    // 拖动：先判断是横向拖，再接管指针，单纯点一下仍然是正常点链接
    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, phi: phi, id: e.pointerId }; moved = false; hist = [];
    });
    svg.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== down.id) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!moved) {
        if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
        moved = true; st.drag = true; snap = null;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        svg.classList.add('dragging');
      }
      var scale = svg.getBoundingClientRect().width / c.W;
      phi = down.phi - dx / (rx * scale) / RAD;
      var now = performance.now();
      hist.push([now, phi]); while (hist.length > 1 && now - hist[0][0] > 120) hist.shift();
      update(phi);
    });
    function release(e) {
      if (!down || (e && e.pointerId !== down.id)) return;
      if (moved) {
        if (hist.length > 1) {
          var h0 = hist[0], h1 = hist[hist.length - 1], span = (h1[0] - h0[0]) / 1000;
          vel = span > 0 ? clamp((h1[1] - h0[1]) / span, -240, 240) : 0;
        }
        st.drag = false; justDragged = true; svg.classList.remove('dragging');
        setTimeout(function () { justDragged = false; }, 0);
        start();
      }
      down = null;
    }
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);
    svg.addEventListener('dragstart', function (e) { e.preventDefault(); });
    svg.addEventListener('click', function (e) { if (justDragged || moved && st.drag) { e.preventDefault(); e.stopPropagation(); } }, true);

    update(phi);
    this.kick = start;
    start();
  }

  svgs.forEach(function (svg) { shared.orbits.push(new Orbit(svg)); });

  // 暂停 / 继续按钮（动态内容要能让人停下来）
  var wrap = svgs[0].parentNode;
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'orbit-toggle';
  var label = function () {
    btn.setAttribute('aria-label', shared.userPaused ? '继续旋转' : '暂停旋转');
    btn.setAttribute('aria-pressed', String(shared.userPaused));
  };
  btn.addEventListener('click', function () {
    shared.userPaused = !shared.userPaused; label();
    shared.orbits.forEach(function (o) { o.kick(); });
  });
  label();
  wrap.appendChild(btn);
  var syncReduce = function () {
    btn.hidden = reduce.matches;
    shared.orbits.forEach(function (o) { o.kick(); });
  };
  syncReduce();
  if (reduce.addEventListener) reduce.addEventListener('change', syncReduce);
})();
