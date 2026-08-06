/* Кружка пива в шапке страницы Кости.

   Рисунок собран SVG-ом (стекло, ручка, пена, пузыри), а не вырезан из фото:
   жидкость должна жить отдельным слоем от стекла, иначе её нечем наклонять.

   Физика простая. Экран считаем окном в мир: кружка к нему приклеена, а
   поверхность пива держится перпендикулярно земле. Направление «вниз» берём из
   deviceorientation — beta/gamma дают проекцию гравитации на плоскость экрана,
   её угол и есть наклон поверхности. Доводим угол пружиной, поэтому пиво не
   следует за телефоном мгновенно: перелетает и пару секунд качается. Дальше
   SPILL_AT градусов — плещет через нижний край, уровень падает и потом медленно
   возвращается (иначе кружка однажды опустеет и шутка кончится).

   iOS 13+ отдаёт гироскоп только после DeviceOrientationEvent.requestPermission(),
   и только из обработчика настоящего тапа — поэтому цепляемся к первому тапу по
   странице (обычно это тап по интро-конверту). Требуется https, он есть.
   Где датчика нет вовсе (десктоп) — ведём наклон мышью плюс лёгкое покачивание,
   чтобы кружка не выглядела мёртвой.

   При prefers-reduced-motion рисуем статичную кружку и не заводим цикл. */
(function () {
  'use strict';

  /* ------------------------------------------------------------- геометрия */
  /* Система координат рисунка: 360×340. Кружка стоит в центре, справа запас
     под ручку, снизу — под капли, улетающие мимо. */
  var PIVOT_X = 170, PIVOT_Y = 190;   // вокруг чего вращается жидкость
  var FULL_Y = 96, EMPTY_Y = 286;     // поверхность при level = 1 и level = 0
  var FULL = 0.82;                    // сколько налито по умолчанию
  var MAX_TILT = 26;                  // предел наклона поверхности, градусы
  var SPILL_AT = 16;                  // с какого угла плещет через край
  var RIM_Y = 70, RIM_L = 92, RIM_R = 248;

  /* Полилиния поверхности живёт в локальной системе жидкости. При повороте до
     26° видимая часть кружки укладывается в x ∈ [0, 340] — считать шире незачем. */
  var SURF_X0 = 0, SURF_X1 = 340, SURF_STEP = 12;

  var BODY = 'M 92,70 L 100,286 Q 100,300 116,300 L 224,300 Q 240,300 240,286 ' +
             'L 248,70 A 78,12 0 0 1 92,70 Z';
  var INNER = 'M 100,72 A 70,10 0 0 1 240,72 L 233,282 Q 233,291 222,291 ' +
              'L 118,291 Q 107,291 107,282 Z';
  var HANDLE = 'M 246,104 C 306,98 318,216 244,208 L 244,192 C 296,198 288,118 244,122 Z';

  var COLOR = {
    ink: '#3E342C',        // контур, как у остальной вёрстки бланка
    glass: '#F3ECDE',      // пустое стекло
    beerTop: '#E7B04A',
    beerMid: '#D28E2A',
    beerLow: '#B4701C',
    foam: '#FAF3E2'
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------- разметка */
  function markup() {
    var i, s;

    /* Пена: шапка из кружков поверх линии поверхности. Позиции по x фиксированы,
       по y пересчитываются каждый кадр вместе с волной; data-lift поднимает каждый
       кружок на свою высоту, иначе гребень выходит ровным, как линейка. */
    var froth = '';
    var lift = [5, 9, 3, 11, 6, 13, 4, 9, 7, 12, 5];
    for (i = 0; i < 15; i++) {
      froth += '<circle data-froth="' + i + '" data-lift="' + lift[i % lift.length] + '" cx="' +
        (8 + i * 23) + '" cy="0" r="' + (5 + (i % 4) * 1.7).toFixed(1) +
        '" fill="' + COLOR.foam + '"/>';
    }

    var bubbles = '';
    for (i = 0; i < 9; i++) bubbles += '<circle data-bubble="' + i + '" cx="0" cy="0" r="2" fill="rgba(255,255,255,.42)"/>';

    var drops = '';
    for (i = 0; i < 16; i++) drops += '<circle data-drop="' + i + '" cx="0" cy="0" r="3" fill="' + COLOR.beerMid + '" opacity="0"/>';

    /* Кадр сдвинут вправо от нуля: корпус занимает 92…248, ручка тянется до 318,
       и без сдвига слева оставался пустой столбец. Снизу и справа оставлен запас
       под капли — за границу кадра они не выходят, иначе на узком экране
       появлялась бы горизонтальная прокрутка. */
    s = '<svg viewBox="16 30 350 324" width="100%" style="display: block" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<clipPath id="bmInner"><path d="' + INNER + '"/></clipPath>' +
        '<linearGradient id="bmBeer" gradientUnits="userSpaceOnUse" x1="0" y1="90" x2="0" y2="300">' +
          '<stop offset="0" stop-color="' + COLOR.beerTop + '"/>' +
          '<stop offset=".5" stop-color="' + COLOR.beerMid + '"/>' +
          '<stop offset="1" stop-color="' + COLOR.beerLow + '"/>' +
        '</linearGradient>' +
      '</defs>' +

      /* тень: без неё кружка висит в воздухе */
      '<ellipse cx="170" cy="308" rx="88" ry="9" fill="rgba(93,74,58,.13)"/>' +

      /* ручка уходит за корпус, поэтому рисуется первой */
      '<path d="' + HANDLE + '" fill="' + COLOR.glass + '" stroke="' + COLOR.ink + '" stroke-width="3" stroke-linejoin="round" opacity=".92"/>' +

      /* устье и пустое стекло — фон, по которому потом гуляет пиво */
      '<ellipse cx="170" cy="70" rx="78" ry="12" fill="#E6DAC2"/>' +
      '<path d="' + BODY + '" fill="' + COLOR.glass + '"/>' +

      '<g clip-path="url(#bmInner)">' +
        '<g data-liquid="1">' +
          '<path data-beer="1" fill="url(#bmBeer)"/>' +
          '<g data-bubbles="1">' + bubbles + '</g>' +
          '<path data-foam="1" fill="none" stroke="' + COLOR.foam + '" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
          froth +
        '</g>' +
      '</g>' +

      /* стекло поверх пива: лёгкая белёсость, блики и контур */
      '<path d="' + BODY + '" fill="rgba(255,255,255,.14)" stroke="' + COLOR.ink + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M 92,70 A 78,12 0 0 1 248,70" fill="none" stroke="' + COLOR.ink + '" stroke-width="2" opacity=".45"/>' +
      '<rect x="113" y="92" width="11" height="176" rx="5.5" fill="#FFFFFF" opacity=".34"/>' +
      '<rect x="214" y="104" width="6" height="120" rx="3" fill="#FFFFFF" opacity=".2"/>' +

      '<g data-drops="1">' + drops + '</g>' +
    '</svg>';
    return s;
  }

  /* ------------------------------------------------------------ поверхность */
  function wave(x, amp, phase) {
    return Math.sin(x * 0.045 + phase) * amp +
           Math.sin(x * 0.021 - phase * 0.6) * amp * 0.55;
  }

  function surfaceLine(y, amp, phase) {
    var d = '', x;
    for (x = SURF_X0; x <= SURF_X1; x += SURF_STEP) {
      d += (x === SURF_X0 ? 'M ' : ' L ') + x + ',' + (y + wave(x, amp, phase)).toFixed(1);
    }
    return d;
  }

  /* ------------------------------------------------------------------- сцена */
  function mount(host) {
    host.innerHTML = markup();

    var svg = host.querySelector('svg');
    var liquid = svg.querySelector('[data-liquid]');
    var beer = svg.querySelector('[data-beer]');
    var foam = svg.querySelector('[data-foam]');
    var froth = svg.querySelectorAll('[data-froth]');
    var bubbleEls = svg.querySelectorAll('[data-bubble]');
    var dropEls = svg.querySelectorAll('[data-drop]');
    var hint = document.querySelector('[data-beer-hint]');

    var angle = 0, vel = 0, target = 0;   // градусы наклона поверхности
    var level = FULL, phase = 0;
    var bubbles = [], drops = [], i;

    for (i = 0; i < bubbleEls.length; i++) {
      bubbles.push({ x: 112 + Math.random() * 116, y: 150 + Math.random() * 130,
                     r: 1.4 + Math.random() * 2.1, v: 0.3 + Math.random() * 0.5 });
    }
    for (i = 0; i < dropEls.length; i++) drops.push(null);

    function surfaceY() { return FULL_Y + (1 - level) * (EMPTY_Y - FULL_Y); }

    function draw(amp) {
      var y = surfaceY();
      var line = surfaceLine(y, amp, phase);
      beer.setAttribute('d', line + ' L ' + SURF_X1 + ',520 L ' + SURF_X0 + ',520 Z');
      foam.setAttribute('d', line);
      liquid.setAttribute('transform', 'rotate(' + angle.toFixed(2) + ' ' + PIVOT_X + ' ' + PIVOT_Y + ')');
      for (var k = 0; k < froth.length; k++) {
        var fx = +froth[k].getAttribute('cx');
        froth[k].setAttribute('cy', (y + wave(fx, amp, phase) - froth[k].getAttribute('data-lift')).toFixed(1));
      }
    }

    /* ------------------------------------------------------- статичный режим */
    if (reduce) { draw(0); return; }

    /* ------------------------------------------------------------ источники */
    var sensor = false;          // пришло хоть одно событие датчика
    var pointerTilt = 0;         // запасной наклон мышью
    var hintShown = false, hintHidden = false, born = now();

    function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function onOrientation(e) {
      if (e.beta == null && e.gamma == null) return;
      if (!sensor) { sensor = true; showHint(); }

      var b = (e.beta || 0) * Math.PI / 180;
      var g = (e.gamma || 0) * Math.PI / 180;
      /* проекция гравитации на плоскость экрана: gx вправо, gy вниз */
      var gx = Math.sin(g);
      var gy = Math.sin(b) * Math.cos(g);

      /* в ландшафте вёрстка повёрнута относительно осей устройства */
      var so = (window.screen && screen.orientation && screen.orientation.angle) || window.orientation || 0;
      if (so) {
        var r = -so * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        var nx = gx * c - gy * s;
        gy = gx * s + gy * c;
        gx = nx;
      }

      /* Телефон лёжа на столе: горизонтальной составляющей почти нет, направление
         «вниз» на экране неопределимо — гасим наклон вместо случайных бросков. */
      var mag = Math.sqrt(gx * gx + gy * gy);
      var a = -Math.atan2(gx, gy) * 180 / Math.PI;
      target = clamp(a * Math.min(1, mag / 0.35), -MAX_TILT, MAX_TILT);
      if (Math.abs(target) > 10) hideHint();
    }

    function listen() { window.addEventListener('deviceorientation', onOrientation); }

    /* iOS: разрешение просят строго из жеста, поэтому ждём первый тап */
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      var ask = function () {
        document.removeEventListener('click', ask, true);
        document.removeEventListener('touchend', ask, true);
        try {
          DeviceOrientationEvent.requestPermission().then(function (state) {
            if (state === 'granted') listen();
          })['catch'](function () {});
        } catch (err) { /* отказ — остаёмся на запасном наклоне */ }
      };
      document.addEventListener('click', ask, true);
      document.addEventListener('touchend', ask, true);
    } else {
      listen();
    }

    /* Запасной наклон мышью: включаем, только если датчик так и не отозвался. */
    window.addEventListener('pointermove', function (e) {
      if (sensor) return;
      pointerTilt = clamp(-((e.clientX / (window.innerWidth || 1)) - 0.5) * 2 * 15, -15, 15);
    });

    function showHint() {
      if (!hint || hintShown || hintHidden) return;
      hintShown = true;
      hint.style.opacity = '1';
    }
    function hideHint() {
      if (!hint || hintHidden) return;
      hintHidden = true;
      hint.style.opacity = '0';
    }

    /* ---------------------------------------------------------------- капли */
    function spill(gxs, gys, side) {
      var slot = -1;
      for (var k = 0; k < drops.length; k++) if (!drops[k]) { slot = k; break; }
      if (slot < 0) return;
      /* вдоль поверхности наружу плюс сразу вниз по гравитации */
      var tx = gys * side, ty = -gxs * side;
      drops[slot] = {
        x: (side > 0 ? RIM_R : RIM_L) + tx * 4 + (Math.random() - 0.5) * 10,
        y: RIM_Y + ty * 4 + (Math.random() - 0.5) * 6,
        vx: gxs * 1.5 + tx * 1.1, vy: gys * 1.5 + ty * 1.1,
        r: 2.2 + Math.random() * 2.3, life: 1
      };
    }

    function stepDrops(gxs, gys) {
      for (var k = 0; k < drops.length; k++) {
        var d = drops[k], el = dropEls[k];
        if (!d) { if (el.getAttribute('opacity') !== '0') el.setAttribute('opacity', '0'); continue; }
        d.vx += gxs * 0.26; d.vy += gys * 0.26;
        d.x += d.vx; d.y += d.vy;
        if (d.y > 360 || d.x < -40 || d.x > 400) { d.life -= 0.12; }
        if (d.life <= 0) { drops[k] = null; el.setAttribute('opacity', '0'); continue; }
        el.setAttribute('cx', d.x.toFixed(1));
        el.setAttribute('cy', d.y.toFixed(1));
        el.setAttribute('r', d.r.toFixed(1));
        el.setAttribute('opacity', (0.9 * d.life).toFixed(2));
      }
    }

    /* ----------------------------------------------------------------- цикл */
    var running = true, last = now();

    function frame() {
      if (!running) return;
      var t = now();
      var steps = clamp(Math.round((t - last) / 16.7), 1, 3);
      last = t;

      var k, aim = target;
      if (!sensor) aim = pointerTilt + Math.sin(t / 1400) * 1.8;   // десктоп: живое покачивание

      for (k = 0; k < steps; k++) {
        vel += (aim - angle) * 0.055;   // пружина: перелёт и затухающее качание
        vel *= 0.87;
        angle += vel;
        phase += 0.075 + Math.min(0.06, Math.abs(vel) * 0.02);
      }

      var amp = Math.min(7, 0.9 + Math.abs(vel) * 2.2);
      draw(amp);

      /* пузырьки поднимаются в системе жидкости, то есть перпендикулярно поверхности */
      var top = surfaceY();
      for (k = 0; k < bubbles.length; k++) {
        var b = bubbles[k];
        b.y -= b.v * steps;
        b.x += Math.sin(t / 700 + k) * 0.25;
        if (b.y < top + 10) { b.y = 280 + Math.random() * 10; b.x = 112 + Math.random() * 116; }
        bubbleEls[k].setAttribute('cx', b.x.toFixed(1));
        bubbleEls[k].setAttribute('cy', b.y.toFixed(1));
        bubbleEls[k].setAttribute('r', b.r.toFixed(1));
      }

      /* «вниз» в координатах экрана — та же ось, по которой повёрнута жидкость */
      var ar = angle * Math.PI / 180;
      var gxs = -Math.sin(ar), gys = Math.cos(ar);
      var over = Math.abs(angle) - SPILL_AT;
      if (over > 0 && level > 0.3) {
        var rate = Math.min(0.55, over / 14);
        if (Math.random() < rate) spill(gxs, gys, angle < 0 ? 1 : -1);
        level -= 0.0016 * steps * Math.min(1, over / 6);
      } else if (level < FULL) {
        level = Math.min(FULL, level + 0.0007 * steps);
      }
      stepDrops(gxs, gys);

      if (hintShown && !hintHidden && t - born > 12000) hideHint();
      requestAnimationFrame(frame);
    }

    /* Считать кадры под свёрнутой вкладкой или когда шапка укручена за экран
       незачем — это чистый расход батареи на телефоне. */
    function setRunning(on) {
      if (on === running) return;
      running = on;
      if (on) { last = now(); requestAnimationFrame(frame); }
    }
    document.addEventListener('visibilitychange', function () { setRunning(!document.hidden); });
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        setRunning(entries[0].isIntersecting && !document.hidden);
      }, { threshold: 0 }).observe(host);
    }

    draw(1);
    requestAnimationFrame(frame);
  }

  /* Точка монтирования приезжает вместе с рендером компонента (support.js), а он
     стартует после нас — поэтому ждём её появления, а не хватаем сразу. */
  function waitForMount() {
    var tries = 0;
    var timer = setInterval(function () {
      var host = document.querySelector('[data-beer-mug]');
      if (host && !host.dataset.beerMugReady) {
        host.dataset.beerMugReady = '1';
        clearInterval(timer);
        mount(host);
      } else if (++tries > 80) {
        clearInterval(timer);
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForMount, { once: true });
  } else {
    waitForMount();
  }
})();
