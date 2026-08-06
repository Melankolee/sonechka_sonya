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
  var BEND = 1.55;        // во сколько раз стягивается картинка у самого борта
  var BEND_P = 3;         // как резко нарастает стягивание к краю

  var COLOR = {
    beerTop: '#E29A24',   // под самой пеной пиво самое густое
    beerMid: '#F0B32C',
    beerLow: '#F8CE38',   // к середине бокала оно светлеет, как на просвет
    beerDeep: '#CE8214',  // у самого дна снова густеет
    glass: '#F6EFDF',     // толстое стекло донышка
    foamTop: '#FFFFFF',
    foamMid: '#FCF6EA',
    foamLow: '#F2E2C2'    // у самой границы пена подкрашена пивом
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function mount(host) {
    /* Две роли одного рисунка: сверху страницы — верх бокала с пенной шапкой,
       в футере — дно, где пены нет, зато есть закруглённое толстое стекло. */
    var mode = host.getAttribute('data-beer-mode') === 'bottom' ? 'bottom' : 'top';
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display: block; width: 100%; height: 100%';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var scene = document.createElement('canvas');    // плоская сцена до искажения бортами
    var sctx = scene.getContext('2d');
    var hint = document.querySelector('[data-beer-hint]');

    var W = 0, H = 0, u = 1, dpr = 1;
    var SIDE = 0, EXTRA = 0;                 // ширина искажённой полосы и запас исходника под неё
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
      /* Сцена шире кадра на EXTRA с каждой стороны: полоса у борта показывает
         жидкость, которая на плоской картинке лежала бы за краем экрана. */
      SIDE = Math.min(W * 0.17, H * 0.42);
      EXTRA = SIDE * (BEND - 1);
      scene.width = Math.round((W + 2 * EXTRA) * dpr);
      scene.height = canvas.height;
      u = H / BASE_H;
      /* Запас по краям — на поворот: при 16° самый дальний угол уезжает примерно
         на четверть большей стороны, дальше рисовать незачем. */
      var pad = Math.max(W, H) * 0.24;
      X0 = -pad; X1 = W + pad; YTOP = -pad; YBOT = H + pad;
      makeBubbles();
      if (mode === 'top') buildFoam();
    }

    /* Откуда начинается жидкость: сверху — от линии пены, у дна — от края поля,
       потому что никакой свободной поверхности в дне бокала нет. */
    function liquidTop() { return mode === 'bottom' ? YTOP : H * REST; }

    /* Пузырьки в пиве: на фото их сотни, поэтому считаем от площади поля.
       Мелких должно быть заметно больше крупных — отсюда квадрат случайной
       величины и в радиусе, и в скорости. */
    function makeBubbles() {
      var span = X1 - X0, top = liquidTop(), depth = YBOT - top;
      var count = clamp(Math.round(span * depth / 220), 200, 900);
      bubbles.length = 0;
      for (var i = 0; i < count; i++) {
        var rr = Math.random();
        bubbles.push({
          x: X0 + Math.random() * span,
          y: top + Math.random() * depth,
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
    /* Сцена рисуется плоской в отдельный холст, а на экран попадает уже через
       compose() — иначе искажение у бортов пришлось бы закладывать в каждую
       кривую отдельно. */
    function paint(amp) {
      var y0 = surfaceY(), step = 14 * u;
      var x, k;

      sctx.setTransform(dpr, 0, 0, dpr, EXTRA * dpr, 0);
      sctx.clearRect(-EXTRA, 0, W + 2 * EXTRA, H);

      sctx.save();
      sctx.translate(W / 2, H * 0.55);
      sctx.rotate(angle * Math.PI / 180);
      sctx.translate(-W / 2, -H * 0.55);

      if (mode === 'top') {
        /* пена лежит первой: пиво накроет её своей волнистой кромкой */
        sctx.drawImage(foamCv, X0, YTOP, foamW, foamH);

        /* пиво: волнистый верх, дальше вниз с запасом за нижний край кадра */
        sctx.beginPath();
        sctx.moveTo(X0, y0 + wave(X0, amp));
        for (x = X0 + step; x < X1; x += step) sctx.lineTo(x, y0 + wave(x, amp));
        sctx.lineTo(X1, y0 + wave(X1, amp));
        sctx.lineTo(X1, YBOT);
        sctx.lineTo(X0, YBOT);
        sctx.closePath();
        var grad = sctx.createLinearGradient(0, y0, 0, H * 1.05);
        grad.addColorStop(0, COLOR.beerTop);
        grad.addColorStop(0.45, COLOR.beerMid);
        grad.addColorStop(1, COLOR.beerLow);
        sctx.fillStyle = grad;
        sctx.fill();
      } else {
        /* дно: свободной поверхности нет, жидкость заливает всё поле, а к самому
           дну густеет — там смотришь сквозь толщу пива и через толстое стекло */
        var gb = sctx.createLinearGradient(0, YTOP, 0, H);
        gb.addColorStop(0, COLOR.beerLow);
        gb.addColorStop(0.55, COLOR.beerMid);
        gb.addColorStop(1, COLOR.beerDeep);
        sctx.fillStyle = gb;
        sctx.fillRect(X0, YTOP, X1 - X0, YBOT - YTOP);
      }

      /* пузырьки: поднимаются в системе жидкости, то есть перпендикулярно
         поверхности, а не к верху экрана */
      sctx.fillStyle = 'rgba(255,248,226,.55)';
      for (k = 0; k < bubbles.length; k++) {
        var b = bubbles[k];
        sctx.globalAlpha = b.a;
        sctx.beginPath();
        sctx.arc(b.x, b.y, b.r, 0, 6.2832);
        sctx.fill();
      }
      sctx.globalAlpha = 1;

      /* Кромка: пена не обрывается по линейке, поэтому вдоль самой волны сажаем
         живые кружки — они и цепляются за пиво, когда оно уходит вбок. */
      var seed = 1;
      for (x = X0; mode === 'top' && x < X1; x += 9 * u) {
        seed = (seed * 9301 + 49297) % 233280;
        var rnd = seed / 233280;
        sctx.globalAlpha = 0.5 + rnd * 0.45;
        sctx.fillStyle = rnd < 0.22 ? '#F0DEB8' : '#FFFDF7';
        sctx.beginPath();
        sctx.arc(x + rnd * 9 * u, y0 + wave(x, amp) - (rnd - 0.42) * 11 * u,
                (1.2 + rnd * rnd * 6) * u, 0, 6.2832);
        sctx.fill();
      }
      sctx.globalAlpha = 1;

      sctx.restore();
      compose();
    }

    /* Насколько далеко за экран уходит исходник для точки в полосе: v = 0 на
       внутренней границе полосы, 1 у самого борта. Первое слагаемое держит на
       стыке с серединой масштаб ровно 1, второе разгоняет стягивание к борту. */
    function bend(v) {
      return v / BEND + (1 - 1 / BEND) * Math.pow(v, BEND_P);
    }

    /* Борта бокала. Стекло цилиндрическое, поэтому к краям картинка сжимается:
       у стенки в тот же пиксель попадает всё более широкая полоса жидкости.
       Полоса источника шириной SIDE*BEND укладывается в SIDE на экране, причём
       на внутренней границе совпадают и масштаб, и само содержимое — иначе там
       был бы виден шов. Плюс мениск (у стенки жидкость лезет вверх), потемнение
       от толщи пива и блик на стекле. */
    function compose() {
      var S = SIDE, E = EXTRA;
      var lift = H * 0.035;
      var d = dpr, step = 2, x, w, t, up, s0, s1;

      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* середина без искажений — одной картинкой */
      ctx.drawImage(scene, (S + E) * d, 0, (W - 2 * S) * d, H * d, S, 0, W - 2 * S, H);

      for (x = 0; x < S; x += step) {
        w = Math.min(step, S - x);
        s0 = S - S * BEND * bend(1 - x / S);            // левее внутренней границы
        s1 = S - S * BEND * bend(1 - (x + w) / S);
        t = 1 - x / S;                        // 1 у самой стенки
        up = lift * t * t;
        /* +0.6 к ширине — чтобы между полосками не оставалось волосяных швов */
        ctx.drawImage(scene, (s0 + E) * d, 0, Math.max(1, (s1 - s0) * d), H * d,
                      x, -up, w + 0.6, H + up);
        ctx.drawImage(scene, (W - s1 + E) * d, 0, Math.max(1, (s1 - s0) * d), H * d,
                      W - x - w, -up, w + 0.6, H + up);
      }

      /* у стенки смотришь сквозь всю толщу пива — там оно гуще и темнее */
      var dark = ctx.createLinearGradient(0, 0, S * 1.1, 0);
      dark.addColorStop(0, 'rgba(96,48,4,.45)');
      dark.addColorStop(0.3, 'rgba(126,68,10,.16)');
      dark.addColorStop(1, 'rgba(126,68,10,0)');
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, S * 1.1, H);
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, S * 1.1, H);
      ctx.restore();

      /* блик: стекло ловит свет полосой чуть в стороне от самого края */
      var hx = S * 0.46, hw = S * 0.34;
      var gl = ctx.createLinearGradient(hx - hw, 0, hx + hw, 0);
      gl.addColorStop(0, 'rgba(255,255,255,0)');
      gl.addColorStop(0.5, 'rgba(255,255,255,.26)');
      gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(hx - hw, 0, hw * 2, H);
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.fillStyle = gl;
      ctx.fillRect(hx - hw, 0, hw * 2, H);
      ctx.restore();

      if (mode === 'bottom') bottomGlass();
    }

    /* Донышко: жидкость обрывается дугой, ниже идёт толстое стекло. Дуга рисуется
       уже после искажения бортами — стекло приклеено к экрану и не наклоняется
       вместе с пивом. */
    function bottomGlass() {
      var bowl = H * 0.74;          // где начинается закругление
      var dep = H * 0.15;           // насколько провисает середина
      var thick = H * 0.07;         // толщина донышка

      function arc(y) {
        ctx.moveTo(-2, y);
        ctx.quadraticCurveTo(W / 2, y + dep * 2, W + 2, y);
      }

      /* всё ниже дуги — уже не бокал */
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';   // destination-out стирает по альфе источника, нужен непрозрачный
      ctx.beginPath();
      arc(bowl);
      ctx.lineTo(W + 2, H + 2);
      ctx.lineTo(-2, H + 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      /* стекло между дугой жидкости и внешней дугой дна */
      ctx.beginPath();
      arc(bowl);
      ctx.lineTo(W + 2, bowl + thick);
      ctx.quadraticCurveTo(W / 2, bowl + thick + dep * 2, -2, bowl + thick);
      ctx.closePath();
      var gg = ctx.createLinearGradient(0, bowl, 0, bowl + dep + thick);
      gg.addColorStop(0, 'rgba(214,150,44,.55)');
      gg.addColorStop(0.45, COLOR.glass);
      gg.addColorStop(1, 'rgba(206,182,140,.9)');
      ctx.fillStyle = gg;
      ctx.fill();

      /* свет, собравшийся в толще донышка, и тонкая тень по внешнему краю */
      ctx.beginPath();
      arc(bowl + thick * 0.34);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = Math.max(1, 2 * u);
      ctx.stroke();
      ctx.beginPath();
      arc(bowl + thick);
      ctx.strokeStyle = 'rgba(120,88,40,.35)';
      ctx.lineWidth = Math.max(1, 1.4 * u);
      ctx.stroke();
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

      /* Пузырьки всплывают в системе жидкости: у дна им упираться не во что,
         поэтому там они просто уходят за верх поля и заводятся снизу заново. */
      var ceil = mode === 'bottom' ? YTOP : y0;
      for (k = 0; k < bubbles.length; k++) {
        var b = bubbles[k];
        b.y -= b.v * steps;
        b.x += Math.sin(t / 900 + k) * 0.2 * u;
        if (b.y < ceil + (mode === 'bottom' ? 0 : wave(b.x, amp)) + b.r) {
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
      var hosts = document.querySelectorAll('[data-beer-header]');
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        if (!host.clientHeight || host.dataset.beerReady) continue;
        host.dataset.beerReady = '1';
        mount(host);
      }
      /* Блоков на странице два — шапка и футер, — и приезжают они одним рендером,
         но ждём до конца отсчёта: вдруг футер отрисуется следующим тиком. */
      if (++tries > 80) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForMount, { once: true });
  } else {
    waitForMount();
  }
})();
