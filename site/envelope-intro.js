/* Интро-конверт.

   Порт анимации «Анимация открытия конверта» (сцены Прилёт → Тап → Печать →
   Открытие → Разлив) на обычный DOM: та же геометрия, те же три функции
   плавности и та же композиция слоёв (тень → задняя стенка → письмо → передняя
   стенка → печать), но без React/Babel и без монтажной панели — вместо
   таймлайна сценами управляет тап гостя.

   Финал: письмо разворачивается на весь экран и растворяется, открывая само
   приглашение. Пока интро идёт, у <html> висит data-intro — по нему index.html
   придерживает свои появления, а по событию envelope-intro:done запускает их.

   Отключается через ?intro=0 и при prefers-reduced-motion. */
(function () {
  'use strict';

  var skip = /[?&]intro=0/.test(location.search) ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (skip) return;

  /* ------------------------------------------------------------- геометрия */
  var ENV_SRC_W = 916;         // ширина конверта в исходной сцене 1080×1920
  var ASPECT = 916 / 600;      // пропорции конверта

  var COLOR = {               // shades('#E8DCC8') из envelope-scenes, посчитанные заранее
    face: '#E8DCC8',
    front: '#DCCEB8',
    side: '#E1D4BF',
    flap: '#EADFCB',
    inner: '#C4B49E'
  };

  var SPECKLES = [
    'radial-gradient(circle at 18% 26%, rgba(108,84,58,.055) 0 1px, rgba(0,0,0,0) 1.7px)',
    'radial-gradient(circle at 73% 11%, rgba(108,84,58,.045) 0 1.2px, rgba(0,0,0,0) 1.9px)',
    'radial-gradient(circle at 41% 78%, rgba(108,84,58,.05) 0 1px, rgba(0,0,0,0) 1.6px)',
    'radial-gradient(circle at 88% 61%, rgba(108,84,58,.04) 0 1.4px, rgba(0,0,0,0) 2.1px)',
    'radial-gradient(circle at 57% 44%, rgba(255,255,255,.10) 0 1.2px, rgba(0,0,0,0) 1.9px)',
    'radial-gradient(circle at 9% 63%, rgba(255,255,255,.08) 0 1px, rgba(0,0,0,0) 1.7px)'
  ].join(', ');

  var STAINS = [
    'radial-gradient(42% 34% at 13% 20%, rgba(128,92,44,.20), rgba(0,0,0,0) 68%)',
    'radial-gradient(30% 38% at 84% 14%, rgba(118,84,40,.18), rgba(0,0,0,0) 70%)',
    'radial-gradient(48% 28% at 64% 90%, rgba(122,88,44,.20), rgba(0,0,0,0) 68%)',
    'radial-gradient(26% 30% at 36% 60%, rgba(158,126,78,.14), rgba(0,0,0,0) 72%)',
    'radial-gradient(34% 26% at 97% 64%, rgba(108,76,36,.20), rgba(0,0,0,0) 70%)',
    'radial-gradient(26% 22% at 5% 80%, rgba(116,84,42,.19), rgba(0,0,0,0) 72%)',
    'radial-gradient(22% 18% at 46% 34%, rgba(150,118,70,.13), rgba(0,0,0,0) 74%)',
    'radial-gradient(18% 26% at 74% 48%, rgba(130,96,50,.15), rgba(0,0,0,0) 74%)'
  ].join(', ');

  var WEAVE =
    'repeating-linear-gradient(90deg, rgba(255,255,255,.028) 0 1px, rgba(96,52,58,.014) 1px 2px), ' +
    'repeating-linear-gradient(0deg, rgba(255,255,255,.02) 0 1px, rgba(96,52,58,.01) 1px 3px), ' +
    'radial-gradient(140% 120% at 26% 12%, rgba(255,255,255,.26), rgba(255,255,255,0) 60%)';

  /* ---------------------------------------------------------- математика */
  var clampN = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* ровно три функции движения — как в исходной анимации */
  var MOTION = {
    enter: function (t) { return 1 - Math.pow(1 - t, 3); },
    glide: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  };
  var seg = function (p, a, b, ease) { return ease(clampN((p - a) / (b - a), 0, 1)); };

  /* ------------------------------------------------------------ длительности */
  var DUR = { arrive: 1700, press: 480, seal: 1000, open: 1150, pour: 1500, fade: 620 };
  var AUTO_OPEN_AFTER = 9000;  // если гость не тапнул — открываем сами

  /* ------------------------------------------------------------- состояние */
  var BASE = {
    envX: 0, envY: 0, envRot: 0, envScale: 1, envOpacity: 1,
    flap: 0, sealT: 0, tapT: 0, press: 0, ripple: -1,
    pageT: 0, cam: 1,
    shadowBlur: 55, shadowScale: 1, shadowOp: 0.22
  };

  var L = {};        // текущая раскладка (пиксели вьюпорта)
  var phase = 'arrive';
  var t0 = 0;
  var raf = null;

  /* ----------------------------------------------------------------- DOM */
  function el(tag, style, parent) {
    var n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (parent) parent.appendChild(n);
    return n;
  }

  function grain(parent, o) {
    el('div', 'position:absolute;inset:0;pointer-events:none;opacity:' + o +
      ';background-image:' + SPECKLES + ';background-size:164px 164px', parent).className = 'ei-speck';
    el('div', 'position:absolute;inset:0;pointer-events:none;opacity:' + o +
      ';background-image:' + STAINS, parent);
    el('div', 'position:absolute;inset:0;pointer-events:none;opacity:' + (o * 0.9) +
      ';box-shadow:inset 0 0 60px rgba(96,66,30,.28), inset 0 0 14px rgba(96,66,30,.22)', parent);
  }

  var root, cam, shadowA, shadowB, envBack, backFace, backInner, flapBack,
    letterClip, letter, letterCol, envFront, frontL, frontR, frontFace,
    flapFront, seal, tapWrap, tapRing, tapDot, ripple, hintText;

  function build() {
    root = el('div',
      'position:fixed;inset:0;z-index:9999;overflow:hidden;cursor:pointer;' +
      'background:radial-gradient(120% 70% at 50% 34%, #FFFFFF, rgba(120,110,105,.07) 80%), #FFFFFF;' +
      '-webkit-tap-highlight-color:transparent;transition:opacity ' + DUR.fade + 'ms ease');
    root.id = 'envelope-intro';
    root.setAttribute('role', 'button');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-label', 'Открыть конверт с приглашением');

    cam = el('div', 'position:absolute;inset:0;transform-origin:50% 50%', root);

    shadowA = el('div', 'position:absolute;border-radius:50%;background:rgba(122,72,80,1)', cam);
    shadowB = el('div', 'position:absolute;border-radius:50%;background:rgba(104,78,56,1)', cam);

    /* задняя стенка конверта + раскрытый (уже уехавший назад) клапан */
    envBack = el('div', 'position:absolute', cam);
    backFace = el('div', 'position:absolute;inset:0', envBack);
    grain(backFace, 1);
    backInner = el('div',
      'position:absolute;left:0;top:0;width:100%;height:58%;' +
      'clip-path:polygon(0 0, 100% 0, 50% 100%);' +
      '-webkit-clip-path:polygon(0 0, 100% 0, 50% 100%);' +
      'background:linear-gradient(180deg, ' + COLOR.inner + ', ' + COLOR.side + ');opacity:0', envBack);
    flapBack = makeFlap(envBack, true);

    /* письмо — между стенками конверта, показывается через раскрывающуюся щель */
    letterClip = el('div', 'position:absolute;inset:0', cam);
    letter = el('div', 'position:absolute;inset:0;overflow:hidden;transform-origin:50% 50%;' +
      'background:#EFE9DE', letterClip);
    letterCol = el('div',
      'position:absolute;top:0;bottom:0;left:50%;width:100%;max-width:620px;transform:translateX(-50%);' +
      'background:linear-gradient(180deg, #F5F1E9 0%, #EFE9DE 38%, #EDE6DA 100%);' +
      'box-shadow:0 0 80px rgba(93,74,58,.09)', letter);
    el('div', 'position:absolute;inset:0;pointer-events:none;background-image:' +
      'repeating-linear-gradient(96deg, rgba(150,110,100,.028) 0 2px, rgba(255,255,255,0) 2px 5px)', letterCol);

    /* передняя стенка: два боковых клапана, нижний треугольник, верхний клапан с печатью */
    envFront = el('div', 'position:absolute', cam);
    frontL = el('div',
      'position:absolute;inset:0;opacity:.55;' +
      'clip-path:polygon(0 0, 0 100%, 46% 52%);-webkit-clip-path:polygon(0 0, 0 100%, 46% 52%);' +
      'background:linear-gradient(200deg, ' + COLOR.side + ', ' + COLOR.front + ');' +
      'filter:drop-shadow(2px 0 3px rgba(96,52,58,.22))', envFront);
    frontR = el('div',
      'position:absolute;inset:0;opacity:.55;' +
      'clip-path:polygon(100% 0, 100% 100%, 54% 52%);-webkit-clip-path:polygon(100% 0, 100% 100%, 54% 52%);' +
      'background:linear-gradient(160deg, ' + COLOR.side + ', ' + COLOR.front + ');' +
      'filter:drop-shadow(-2px 0 3px rgba(96,52,58,.22))', envFront);
    frontFace = el('div',
      'position:absolute;inset:0;' +
      'clip-path:polygon(0 100%, 100% 100%, 50% 26%);-webkit-clip-path:polygon(0 100%, 100% 100%, 50% 26%);' +
      'filter:drop-shadow(0 -3px 6px rgba(96,72,48,.26))', envFront);
    grain(frontFace, 1);
    flapFront = makeFlap(envFront, false);

    /* подсказка «тапни» */
    tapWrap = el('div', 'position:absolute;pointer-events:none;opacity:0', cam);
    tapRing = el('div', 'position:absolute;inset:0;border-radius:50%;' +
      'border:3px solid rgba(255,255,255,.9);box-shadow:0 8px 24px rgba(122,72,80,.18)', tapWrap);
    tapDot = el('div', 'position:absolute;border-radius:50%;background:rgba(255,255,255,.9)', tapWrap);
    ripple = el('div', 'position:absolute;border-radius:50%;border:3px solid rgba(255,255,255,.8);' +
      'pointer-events:none;display:none', cam);

    hintText = el('div',
      'position:absolute;left:0;right:0;text-align:center;pointer-events:none;opacity:0;' +
      "font-family:'Manrope', system-ui, sans-serif;font-weight:300;text-transform:uppercase;" +
      'color:rgba(138,56,47,.75);transition:opacity .5s ease', cam);
    hintText.textContent = 'нажмите, чтобы открыть';

    return root;
  }

  function makeFlap(parent, back) {
    var wrap = el('div',
      'position:absolute;left:0;top:0;width:100%;height:58%;' +
      'transform-origin:50% 0%;transform-style:preserve-3d;display:none', parent);
    var face = el('div',
      'position:absolute;inset:0;' +
      'clip-path:polygon(0 0, 100% 0, 50% 100%);-webkit-clip-path:polygon(0 0, 100% 0, 50% 100%);' +
      'background:' + (back
        ? 'linear-gradient(0deg, ' + COLOR.face + ', ' + COLOR.flap + ')'
        : WEAVE + ', linear-gradient(180deg, ' + COLOR.flap + ', ' + COLOR.face + ')') +
      (back ? '' : ';filter:drop-shadow(0 8px 12px rgba(96,72,48,.28))'), wrap);
    grain(face, back ? 0.5 : 1);
    wrap._face = face;
    if (!back) {
      var line = el('div', 'position:absolute;left:0;top:88%;width:100%;height:0', wrap);
      seal = el('img', 'position:absolute;left:50%;top:50%;display:block', line);
      seal.src = './img/seal.png';
      seal.alt = '';
    }
    return wrap;
  }

  /* ----------------------------------------------------- раскладка/ресайз */
  function layout() {
    /* размеры берём у самого оверлея: на мобильных Safari innerHeight и
       высота position:fixed расходятся из-за адресной строки */
    var vw = root.clientWidth || window.innerWidth;
    var vh = root.clientHeight || window.innerHeight;
    var envW = Math.min(vw * 0.86, 560, vh * 0.34 * ASPECT);
    var envH = envW / ASPECT;
    var k = envW / ENV_SRC_W;          // масштаб исходных единиц сцены
    var cx = vw / 2;
    var cy = vh * 0.5;

    L = {
      vw: vw, vh: vh, k: k, envW: envW, envH: envH, cx: cx, cy: cy,
      envTop: cy - envH / 2, envBottom: cy + envH / 2
    };

    var boxCss = 'position:absolute;left:' + (cx - envW / 2) + 'px;top:' + L.envTop +
      'px;width:' + envW + 'px;height:' + envH + 'px;perspective:' + (1800 * k) + 'px';
    envBack.setAttribute('style', boxCss);
    envFront.setAttribute('style', boxCss);

    backFace.style.borderRadius = (18 * k) + 'px';
    backFace.style.background = WEAVE + ', linear-gradient(168deg, ' + COLOR.face + ', ' + COLOR.side + ')';
    backFace.style.boxShadow = 'inset 0 ' + (2 * k) + 'px 0 rgba(255,255,255,.45), inset 0 0 ' +
      (90 * k) + 'px rgba(104,74,38,.16), 0 ' + (26 * k) + 'px ' + (60 * k) + 'px rgba(112,84,54,.22)';

    frontFace.style.borderRadius = (18 * k) + 'px';
    frontFace.style.background = WEAVE + ', linear-gradient(180deg, ' + COLOR.face + ', ' + COLOR.front + ')';
    frontFace.style.boxShadow = 'inset 0 ' + k + 'px 0 rgba(255,255,255,.45), inset 0 ' +
      (-20 * k) + 'px ' + (40 * k) + 'px rgba(96,72,48,.10)';

    flapFront._face.style.boxShadow = 'inset 0 ' + (-14 * k) + 'px ' + (30 * k) + 'px rgba(96,72,48,.10)';

    Array.prototype.forEach.call(root.querySelectorAll('.ei-speck'), function (n) {
      n.style.backgroundSize = (164 * k) + 'px ' + (164 * k) + 'px';
    });

    var D = 186 * k;
    seal.style.width = D + 'px';
    seal.style.height = D + 'px';
    seal.style.marginLeft = (-D / 2) + 'px';
    seal.style.marginTop = (-D / 2) + 'px';

    shadowA.style.left = (cx - 320 * k) + 'px';
    shadowA.style.width = (640 * k) + 'px';
    shadowA.style.height = (120 * k) + 'px';
    shadowB.style.left = (cx - 300 * k) + 'px';
    shadowB.style.width = (600 * k) + 'px';
    shadowB.style.height = (40 * k) + 'px';

    var ring = 300 * k;
    tapWrap.style.left = (cx - ring / 2) + 'px';
    tapWrap.style.top = (cy - ring / 2 - 10 * k) + 'px';
    tapWrap.style.width = ring + 'px';
    tapWrap.style.height = ring + 'px';
    tapRing.style.borderWidth = Math.max(1.5, 3 * k) + 'px';
    tapDot.style.left = (ring / 2 - 12 * k) + 'px';
    tapDot.style.top = (ring / 2 - 12 * k) + 'px';
    tapDot.style.width = (24 * k) + 'px';
    tapDot.style.height = (24 * k) + 'px';

    ripple.style.left = (cx - ring / 2) + 'px';
    ripple.style.top = (cy - ring / 2) + 'px';
    ripple.style.width = ring + 'px';
    ripple.style.height = ring + 'px';
    ripple.style.borderWidth = Math.max(1.5, 3 * k) + 'px';

    hintText.style.top = (L.envBottom + Math.max(28, 60 * k)) + 'px';
    hintText.style.fontSize = Math.max(9, Math.min(11, 11 * (vw / 420))) + 'px';
    hintText.style.letterSpacing = '.28em';
  }

  /* ------------------------------------------------------------- отрисовка */
  function render(s) {
    var k = L.k;

    cam.style.transform = 'scale(' + s.cam + ')';

    var envT = 'translate(' + s.envX + 'px, ' + s.envY + 'px) rotate(' + s.envRot +
      'deg) scale(' + s.envScale + ')';
    envBack.style.transform = envT;
    envFront.style.transform = envT;
    envBack.style.opacity = s.envOpacity;
    envFront.style.opacity = s.envOpacity;

    shadowA.style.top = (L.envBottom - 30 * k + s.envY * 0.35) + 'px';
    shadowA.style.opacity = s.shadowOp * s.envOpacity;
    shadowA.style.filter = 'blur(' + (s.shadowBlur * k) + 'px)';
    shadowA.style.transform = 'translateX(' + (s.envX * 0.4) + 'px) scale(' + s.shadowScale + ')';
    shadowB.style.top = (L.envBottom - 16 * k + s.envY * 0.9) + 'px';
    shadowB.style.opacity = s.shadowOp * 0.7 * s.envOpacity;
    shadowB.style.filter = 'blur(' + (Math.max(8, s.shadowBlur * 0.3) * k) + 'px)';
    shadowB.style.transform = 'translateX(' + (s.envX * 0.9) + 'px) scale(' +
      lerp(1, s.shadowScale, 0.4) + ')';

    backInner.style.opacity = s.flap > 4 ? 1 : 0;

    var flapBackSide = s.flap > 90;
    var flapEl = flapBackSide ? flapBack : flapFront;
    flapBack.style.display = flapBackSide ? 'block' : 'none';
    flapFront.style.display = flapBackSide ? 'none' : 'block';
    flapEl.style.transform = 'rotateX(' + (-s.flap) + 'deg)';

    if (s.sealT < 0.999) {
      var kk = clampN(s.sealT, 0, 1);
      var settle = seg(kk, 0.05, 0.2, MOTION.glide) - seg(kk, 0.2, 0.42, MOTION.glide);
      var gone = seg(kk, 0.24, 0.92, MOTION.glide);
      seal.style.display = 'block';
      seal.style.opacity = 1 - gone;
      seal.style.transform = 'rotate(-5deg) scale(' + (1 + settle * 0.025 - gone * 0.05) +
        ') translateY(' + (-gone * 8 * k) + 'px)';
      seal.style.filter = 'drop-shadow(0 ' + (9 * k) + 'px ' + (12 * k) + 'px rgba(70,35,32,' +
        (0.36 * (1 - gone)) + '))';
    } else {
      seal.style.display = 'none';
    }

    /* письмо */
    var pt = clampN(s.pageT, 0, 1);
    var g = MOTION.glide(pt);
    var yStart = L.cy + L.envH * 0.333;
    var y = lerp(yStart, L.vh / 2, g);
    var sc = lerp(0.66, 1, g);
    var sy = sc * (1 + 0.09 * Math.sin(Math.PI * pt));
    var clipTop = (1 - seg(pt, 0.02, 0.55, MOTION.glide)) * (L.envBottom - 15 * k);
    var clipBottom = (1 - seg(pt, 0.22, 0.9, MOTION.glide)) * (L.vh - L.envBottom + 15 * k);
    letterClip.style.clipPath = 'inset(' + clipTop + 'px 0px ' + clipBottom + 'px 0px)';
    letterClip.style.webkitClipPath = letterClip.style.clipPath;
    letter.style.transform = 'translateY(' + (y - L.vh / 2) + 'px) scale(' + sc + ', ' + sy + ')';
    letter.style.borderRadius = lerp(22 * k, 0, g) + 'px';
    letter.style.boxShadow = '0 ' + (lerp(10, 0, pt) * k) + 'px ' + (lerp(50, 0, pt) * k) +
      'px rgba(122,72,80,' + lerp(0.28, 0, pt) + ')';

    /* подсказка */
    tapWrap.style.opacity = s.tapT * 0.9;
    tapRing.style.transform = 'scale(' + (lerp(0.6, 1, s.tapT) * (1 - s.press * 0.12)) + ')';
    tapDot.style.transform = 'scale(' + (1 - s.press * 0.25) + ')';
    if (s.ripple >= 0) {
      ripple.style.display = 'block';
      ripple.style.transform = 'scale(' + lerp(0.8, 2.6, s.ripple) + ')';
      ripple.style.opacity = 1 - s.ripple;
    } else {
      ripple.style.display = 'none';
    }
  }

  /* --------------------------------------------------------------- сцены */
  function state(over) {
    var s = {};
    for (var key in BASE) s[key] = BASE[key];
    for (var o in over) s[o] = over[o];
    return s;
  }

  function sceneArrive(p) {
    var a = seg(p, 0, 0.7, MOTION.enter);
    var damp = Math.pow(clampN(1 - (p - 0.6) / 0.4, 0, 1), 2);
    var wob = p > 0.5 ? Math.sin((p - 0.55) * Math.PI * 4) * damp : 0;
    return state({
      envY: lerp(L.vh * 0.75, 0, a),
      envX: lerp(L.vw * 0.22, 0, a),
      envRot: lerp(-15, 0, a) + wob * 2.2,
      envScale: lerp(0.74, 1, a),
      shadowBlur: lerp(120, 55, a), shadowScale: lerp(1.3, 1, a), shadowOp: lerp(0.1, 0.22, a),
      cam: lerp(1.06, 1, MOTION.glide(p))
    });
  }

  function sceneWait(ms) {
    var appear = clampN(ms / 420, 0, 1);
    var breathe = 0.86 + 0.14 * Math.sin(ms / 620);
    return state({
      tapT: MOTION.enter(appear) * breathe,
      envY: Math.sin(ms / 1400) * 4 * L.k,
      envRot: Math.sin(ms / 2100) * 0.35
    });
  }

  function scenePress(p) {
    var press = seg(p, 0, 0.35, MOTION.glide) - seg(p, 0.35, 1, MOTION.glide);
    return state({
      tapT: 1 - seg(p, 0.3, 0.85, MOTION.enter),
      press: press,
      ripple: seg(p, 0.05, 1, MOTION.glide),
      envScale: 1 - 0.035 * press,
      shadowBlur: 55 - 10 * press, shadowOp: 0.22 + 0.05 * press,
      cam: lerp(1, 1.12, MOTION.glide(p))
    });
  }

  function sceneSeal(p) {
    var tug = Math.sin(p * Math.PI) * Math.sin(p * Math.PI * 3);
    return state({
      sealT: clampN((p - 0.05) / 0.9, 0, 1),
      envRot: tug * 0.9,
      envY: -Math.sin(p * Math.PI) * 6 * L.k,
      cam: lerp(1.12, 1.14, p)
    });
  }

  function sceneOpen(p) {
    return state({
      sealT: 1,
      flap: 178 * seg(p, 0.06, 0.82, MOTION.glide),
      pageT: 0.12 * seg(p, 0.55, 1, MOTION.glide),
      cam: lerp(1.14, 1.06, MOTION.glide(p))
    });
  }

  function scenePour(p) {
    var k = seg(p, 0.02, 0.88, MOTION.glide);
    return state({
      sealT: 1, flap: 178,
      pageT: lerp(0.12, 1, k),
      envScale: 1 - 0.06 * seg(p, 0.18, 0.9, MOTION.glide),
      envY: L.vh * 0.73 * seg(p, 0.1, 0.92, MOTION.glide),
      envOpacity: 1 - seg(p, 0.82, 1, MOTION.glide),
      cam: lerp(1.06, 1, MOTION.glide(p))
    });
  }

  /* ----------------------------------------------------------- проигрывание */
  function go(next) {
    phase = next;
    t0 = performance.now();
    if (next === 'wait') hintText.style.opacity = '1';
    if (next === 'press') hintText.style.opacity = '0';
  }

  function frame(now) {
    var ms = now - t0;
    if (phase === 'arrive') {
      var p = ms / DUR.arrive;
      if (p >= 1) { render(sceneArrive(1)); go('wait'); }
      else render(sceneArrive(p));
    } else if (phase === 'wait') {
      render(sceneWait(ms));
      if (ms > AUTO_OPEN_AFTER) go('press');
    } else if (phase === 'press') {
      var pp = ms / DUR.press;
      if (pp >= 1) { render(scenePress(1)); go('seal'); }
      else render(scenePress(pp));
    } else if (phase === 'seal') {
      var ps = ms / DUR.seal;
      if (ps >= 1) { render(sceneSeal(1)); go('open'); }
      else render(sceneSeal(ps));
    } else if (phase === 'open') {
      var po = ms / DUR.open;
      if (po >= 1) { render(sceneOpen(1)); go('pour'); }
      else render(sceneOpen(po));
    } else if (phase === 'pour') {
      var pr = ms / DUR.pour;
      if (pr >= 1) { render(scenePour(1)); finish(); return; }
      render(scenePour(pr));
    }
    raf = requestAnimationFrame(frame);
  }

  function finish() {
    phase = 'done';
    raf = null;
    root.style.cursor = 'default';
    root.style.pointerEvents = 'none';
    /* страница уже под письмом — отпускаем её появления и растворяем интро */
    document.documentElement.removeAttribute('data-intro');
    window.__envelopeIntroActive = false;
    document.dispatchEvent(new CustomEvent('envelope-intro:done'));
    requestAnimationFrame(function () { root.style.opacity = '0'; });
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
      window.removeEventListener('resize', onResize);
    }, DUR.fade + 60);
  }

  function open() {
    if (phase === 'arrive') { render(sceneArrive(1)); go('press'); }
    else if (phase === 'wait') go('press');
  }

  function onResize() {
    if (phase === 'done') return;
    layout();
  }

  /* --------------------------------------------------------------- запуск */
  function start() {
    document.body.appendChild(build());
    layout();
    window.addEventListener('resize', onResize);
    root.addEventListener('click', open);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); open(); }
    });
    /* печать грузится картинкой — если не успела, ничего страшного, сцена та же */
    render(sceneArrive(0));
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }

  document.documentElement.setAttribute('data-intro', '');
  window.__envelopeIntroActive = true;

  var style = document.createElement('style');
  style.textContent =
    'html[data-intro], html[data-intro] body { overflow: hidden !important; }' +
    'html[data-intro] [data-reveal] { opacity: 0 !important; }';
  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
