/* Пиво в шапке страницы Кости.

   Кадр во всю ширину: снизу пиво с пузырьками, сверху пенная шапка, над пеной —
   бумага бланка. Всё рисуется на canvas, а не картинкой: пузырьков под сотню и
   поверхность должна гнуться, фотографию так не согнёшь.

   Физика. Экран считаем окном в мир: кадр к нему приклеен, а поверхность пива
   держится перпендикулярно земле. Направление «вниз» берём из deviceorientation —
   beta/gamma дают проекцию гравитации на плоскость экрана, её угол и есть наклон
   поверхности. Доводим угол пружиной, поэтому пиво не следует за телефоном
   мгновенно: перелетает и пару секунд качается, а из гребня на резком движении
   вылетают брызги.

   iOS 13+ отдаёт гироскоп только после DeviceOrientationEvent.requestPermission(),
   и только из обработчика настоящего тапа — поэтому цепляемся к первому тапу по
   странице (обычно это тап по интро-конверту). Требуется https, он есть.
   Где датчика нет вовсе (десктоп) — ведём наклон мышью плюс лёгкое покачивание,
   чтобы кадр не выглядел мёртвым.

   При prefers-reduced-motion рисуем один статичный кадр и не заводим цикл. */
(function () {
  'use strict';

  /* Все размеры заданы в «дизайнерских» пикселях при высоте кадра 460 и потом
     умножаются на u = высота/460 — так рисунок одинаково выглядит и на телефоне,
     и на широкой карточке. */
  var BASE_H = 460;
  var REST = 0.33;        // где стоит граница пены и пива в покое, доля высоты
  var MAX_TILT = 16;      // предел наклона поверхности, градусы

  var COLOR = {
    beerTop: '#E29A24',   // под самой пеной пиво самое густое
    beerMid: '#F0B32C',
    beerLow: '#F8CE38',   // ко дну кадра оно светлеет, как в стекле на просвет
    foamTop: '#FFFFFF',
    foamMid: '#FCF6EA',
    foamLow: '#F2E2C2'    // у самой границы пена подкрашена пивом
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function mount(host) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display: block; width: 100%; height: 100%';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var hint = document.querySelector('[data-beer-hint]');

    var W = 0, H = 0, u = 1, dpr = 1;
    var X0 = 0, X1 = 0, YTOP = 0, YBOT = 0;  // поле рисования шире кадра: при повороте углы уезжают
    var bubbles = [];
    var foamCv = document.createElement('canvas');   // фактура пены: она стоит на месте
    var foamW = 0, foamH = 0;

    var angle = 0, vel = 0, target = 0;   // градусы наклона поверхности
    var phase = 0;

    /* ------------------------------------------------------------- геометрия */
    function resize() {
      W = host.clientWidth || 1;
      H = host.clientHeight || 1;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      u = H / BASE_H;
      /* Запас по краям — на поворот: при 16° самый дальний угол уезжает примерно
         на четверть большей стороны, дальше рисовать незачем. */
      var pad = Math.max(W, H) * 0.24;
      X0 = -pad; X1 = W + pad; YTOP = -pad; YBOT = H + pad;
      makeBubbles();
      buildFoam();
    }

    /* Пузырьки в пиве: на фото их сотни, поэтому считаем от площади поля.
       Мелких должно быть заметно больше крупных — отсюда квадрат случайной
       величины и в радиусе, и в скорости. */
    function makeBubbles() {
      var span = X1 - X0, depth = YBOT - H * REST;
      var count = clamp(Math.round(span * depth / 220), 200, 900);
      bubbles.length = 0;
      for (var i = 0; i < count; i++) {
        var rr = Math.random();
        bubbles.push({
          x: X0 + Math.random() * span,
          y: H * REST + Math.random() * depth,
          r: (0.9 + rr * rr * 5.2) * u,
          v: (0.18 + rr * 1.15) * u,        // крупные всплывают быстрее
          a: 0.35 + Math.random() * 0.5
        });
      }
    }

    /* Пена не течёт: её фактура стоит на месте относительно жидкости, поэтому
       рисуется один раз в отдельный холст и потом просто кладётся картинкой.
       Иначе шесть сотен пузырьков пришлось бы перерисовывать каждый кадр.
       Снизу холст заходит за линию покоя на пару десятков пикселей — там живёт
       шипучая кромка, и волна не должна открывать под пеной дырку. */
    function buildFoam() {
      var over = 18 * u;
      foamW = X1 - X0;
      foamH = H * REST + over - YTOP;
      foamCv.width = Math.round(foamW * dpr);
      foamCv.height = Math.round(foamH * dpr);

      var f = foamCv.getContext('2d');
      f.setTransform(dpr, 0, 0, dpr, 0, 0);
      var g = f.createLinearGradient(0, foamH - H * 0.55, 0, foamH);
      g.addColorStop(0, COLOR.foamTop);
      g.addColorStop(0.6, COLOR.foamMid);
      g.addColorStop(1, COLOR.foamLow);
      f.fillStyle = g;
      f.fillRect(0, 0, foamW, foamH);

      /* Пена — это плотно сидящие ячейки, а не редкие точки: кружки кладём
         внахлёст и обводим, иначе получается конфетти на белом. */
      var count = clamp(Math.round(foamW * foamH / 42), 600, 9000);
      f.lineWidth = Math.max(0.5, 0.7 * u);
      for (var i = 0; i < count; i++) {
        /* гуще к границе с пивом: там пена самая мелкая и живая */
        var dy = Math.pow(Math.random(), 1.15) * foamH;
        var rr = Math.random();
        var r = (1 + rr * rr * 5) * u;
        /* Тени между ячейками — только у самой границы с пивом, где пена ещё
           мокрая. Выше она взбита в плотную белизну, и те же тени читаются там
           как грязь. Порог считаем от видимой части шапки, а не от холста:
           холст уходит вверх за кадр на запас под поворот. */
        var shade = dy < H * REST * 0.45 && Math.random() < 0.32;
        var cx = Math.random() * foamW, cy = foamH - dy;
        f.globalAlpha = shade ? 0.14 + Math.random() * 0.26 : 0.42 + Math.random() * 0.5;
        f.fillStyle = shade ? '#C6A874' : '#FFFFFF';
        f.beginPath();
        f.arc(cx, cy, r, 0, 6.2832);
        f.fill();
        if (!shade && rr > 0.35) {
          f.globalAlpha = 0.16 + Math.random() * 0.2;
          f.strokeStyle = '#C0A472';
          f.stroke();
        }
      }
      f.globalAlpha = 1;
    }

    /* Две синусоиды с разным шагом: одна волна выглядит нарисованной линейкой. */
    function wave(x, amp) {
      return Math.sin(x / (52 * u) + phase) * amp +
             Math.sin(x / (121 * u) - phase * 0.6) * amp * 0.6;
    }

    function surfaceY() { return H * REST; }

    /* ---------------------------------------------------------------- кадр */
    function paint(amp) {
      var y0 = surfaceY(), step = 14 * u;
      var x, k;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      ctx.save();
      ctx.translate(W / 2, H * 0.55);
      ctx.rotate(angle * Math.PI / 180);
      ctx.translate(-W / 2, -H * 0.55);

      /* пена лежит первой: пиво накроет её своей волнистой кромкой */
      ctx.drawImage(foamCv, X0, YTOP, foamW, foamH);

      /* пиво: волнистый верх, дальше вниз с запасом за нижний край кадра */
      ctx.beginPath();
      ctx.moveTo(X0, y0 + wave(X0, amp));
      for (x = X0 + step; x < X1; x += step) ctx.lineTo(x, y0 + wave(x, amp));
      ctx.lineTo(X1, y0 + wave(X1, amp));
      ctx.lineTo(X1, YBOT);
      ctx.lineTo(X0, YBOT);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, y0, 0, H * 1.05);
      grad.addColorStop(0, COLOR.beerTop);
      grad.addColorStop(0.45, COLOR.beerMid);
      grad.addColorStop(1, COLOR.beerLow);
      ctx.fillStyle = grad;
      ctx.fill();

      /* пузырьки: поднимаются в системе жидкости, то есть перпендикулярно
         поверхности, а не к верху экрана */
      ctx.fillStyle = 'rgba(255,248,226,.55)';
      for (k = 0; k < bubbles.length; k++) {
        var b = bubbles[k];
        ctx.globalAlpha = b.a;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* Кромка: пена не обрывается по линейке, поэтому вдоль самой волны сажаем
         живые кружки — они и цепляются за пиво, когда оно уходит вбок. */
      var seed = 1;
      for (x = X0; x < X1; x += 9 * u) {
        seed = (seed * 9301 + 49297) % 233280;
        var rnd = seed / 233280;
        ctx.globalAlpha = 0.5 + rnd * 0.45;
        ctx.fillStyle = rnd < 0.22 ? '#F0DEB8' : '#FFFDF7';
        ctx.beginPath();
        ctx.arc(x + rnd * 9 * u, y0 + wave(x, amp) - (rnd - 0.42) * 11 * u,
                (1.2 + rnd * rnd * 6) * u, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
    else window.addEventListener('resize', resize);

    /* ------------------------------------------------------- статичный режим */
    if (reduce) { paint(0); return; }

    /* ------------------------------------------------------------ источники */
    var sensor = false;          // пришло хоть одно событие датчика
    var pointerTilt = 0;         // запасной наклон мышью
    var hintShown = false, hintHidden = false, born = now();

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
      if (Math.abs(target) > 7) hideHint();
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
      pointerTilt = clamp(-((e.clientX / (window.innerWidth || 1)) - 0.5) * 2 * 11, -11, 11);
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

    /* ----------------------------------------------------------------- цикл */
    var running = true, last = now();

    function frame() {
      if (!running) return;
      var t = now();
      var steps = clamp(Math.round((t - last) / 16.7), 1, 3);
      last = t;

      var k, aim = target;
      if (!sensor) aim = pointerTilt + Math.sin(t / 1500) * 1.4;   // десктоп: живое покачивание

      for (k = 0; k < steps; k++) {
        vel += (aim - angle) * 0.05;    // пружина: перелёт и затухающее качание
        vel *= 0.88;
        angle += vel;
        phase += 0.05 + Math.min(0.06, Math.abs(vel) * 0.02);
      }

      var y0 = surfaceY();
      var amp = Math.min(9 * u, (1.1 + Math.abs(vel) * 2.6) * u);

      for (k = 0; k < bubbles.length; k++) {
        var b = bubbles[k];
        b.y -= b.v * steps;
        b.x += Math.sin(t / 900 + k) * 0.2 * u;
        if (b.y < y0 + wave(b.x, amp) + b.r) {
          b.y = YBOT - Math.random() * H * 0.15;
          b.x = X0 + Math.random() * (X1 - X0);
        }
      }

      paint(amp);

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

    paint(1.1 * u);
    requestAnimationFrame(frame);
  }

  /* Точка монтирования приезжает вместе с рендером компонента (support.js), а он
     стартует после нас — поэтому ждём её появления, а не хватаем сразу. */
  function waitForMount() {
    var tries = 0;
    var timer = setInterval(function () {
      var host = document.querySelector('[data-beer-header]');
      if (host && host.clientHeight && !host.dataset.beerReady) {
        host.dataset.beerReady = '1';
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
