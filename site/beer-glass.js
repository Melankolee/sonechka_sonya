/* Страница Кости как бокал пива.

   Вся карточка — один высокий бокал: сверху пенная шапка, снизу закруглённое
   толстое донышко, между ними пиво, по которому идёт текст приглашения. Рисунок
   собран на canvas по фотографии бокала, но не из неё: пузырьков под тысячу,
   поверхность должна гнуться волной, а жидкость — жить отдельно от стекла.

   Холст один и висит sticky на высоту экрана: рисовать полотно во всю длину
   страницы нельзя (это десятки мегабайт), поэтому каждый кадр считаем, где
   сейчас относительно экрана верх и низ карточки, и рисуем только видимый
   кусок бокала. Прокрутка сама уносит пену вверх и подводит донышко снизу.

   Физика наклона. Экран считаем окном в мир: бокал к нему приклеен, а
   поверхность пива держится перпендикулярно земле. Направление «вниз» берём из
   deviceorientation — beta/gamma дают проекцию гравитации на плоскость экрана,
   её угол и есть наклон поверхности. Доводим угол пружиной, поэтому пиво не
   следует за телефоном мгновенно: перелетает и пару секунд качается.

   iOS 13+ отдаёт гироскоп только после DeviceOrientationEvent.requestPermission(),
   и только из обработчика настоящего тапа — поэтому цепляемся к первому тапу по
   странице (обычно это тап по интро-конверту). Требуется https, он есть.
   Где датчика нет вовсе (десктоп) — ведём наклон мышью плюс лёгкое покачивание.

   При prefers-reduced-motion рисуем один статичный кадр и не заводим цикл. */
(function () {
  'use strict';

  /* Размеры бокала считаем от ширины карточки, а не от экрана: бокал должен
     выглядеть одинаково и на телефоне, и на широкой карточке. */
  var FOAM_AT = 0.30;     // от верха карточки до границы пены и пива
  var BASE_AT = 0.17;     // от низа карточки до дуги донышка
  var MAX_TILT = 16;      // предел наклона поверхности, градусы
  var BEND = 1.55;        // во сколько раз стягивается картинка у самого борта
  var BEND_P = 3;         // как резко нарастает стягивание к краю
  var VEIL = 0.66;        // забеливающая вуаль над пивом под текстом

  var COLOR = {
    beerTop: '#EDA92C',   // под самой пеной пиво самое густое
    beerMid: '#F5C136',
    beerLow: '#F8CE38',
    beerDeep: '#D28E1B',  // у самого дна снова густеет
    glass: '#F6EFDF',     // толстое стекло донышка
    foamTop: '#FFFFFF',
    foamMid: '#FCF6EA',
    foamLow: '#F2E2C2',   // у самой границы пена подкрашена пивом
    veil: '239,233,222'   // тот же кремовый, что у бумаги бланка
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function mount(host) {
    var card = host.parentNode;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display: block; width: 100%; height: 100%';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var scene = document.createElement('canvas');    // плоская сцена до искажения бортами
    var sctx = scene.getContext('2d');
    var hint = document.querySelector('[data-beer-hint]');

    var W = 0, H = 0, CW = 0, u = 1, dpr = 1;
    var SIDE = 0, EXTRA = 0;                 // ширина искажённой полосы и запас исходника под неё
    var X0 = 0, X1 = 0, YTOP = 0, YBOT = 0;  // поле рисования шире экрана: при повороте углы уезжают
    var bubbles = [];
    var foamCv = document.createElement('canvas');   // фактура пены: она стоит на месте
    var foamW = 0, foamH = 0, foamDeep = 0;

    var angle = 0, vel = 0, target = 0;   // градусы наклона поверхности
    var phase = 0;

    /* ------------------------------------------------------------- геометрия */
    function resize() {
      W = host.clientWidth || 1;
      H = host.clientHeight || 1;
      CW = Math.min(W, 620);          // ширина карточки задаёт масштаб бокала
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      /* Сцена шире кадра на EXTRA с каждой стороны: полоса у борта показывает
         жидкость, которая на плоской картинке лежала бы за краем экрана. */
      SIDE = Math.min(W * 0.17, H * 0.3);
      EXTRA = SIDE * (BEND - 1);
      scene.width = Math.round((W + 2 * EXTRA) * dpr);
      scene.height = canvas.height;
      u = CW / 430;
      var pad = Math.max(W, H) * 0.24;
      X0 = -pad; X1 = W + pad; YTOP = -pad; YBOT = H + pad;
      makeBubbles();
      buildFoam();
    }

    /* Где сейчас на экране венчик, граница пены и дно. Считаем от карточки, а не
       от холста: холст висит sticky и в конце страницы отлипает. */
    function marks() {
      var c = card.getBoundingClientRect();
      var h = host.getBoundingClientRect();
      var top = c.top - h.top;
      return {
        top: top,
        height: c.height || 1,
        rim: top + CW * 0.17,
        surface: top + CW * FOAM_AT,
        base: top + (c.height || 1) - CW * BASE_AT
      };
    }

    /* Силуэт бокала из референса: сразу под венчиком стекло быстро сужается,
       дальше идёт почти прямая стенка, у самого низа она расходится обратно в
       ножку. Возвращает полуширину бокала в долях полуширины карточки.
       Сужение взято мягче, чем на фотографии: там бокал в два с лишним раза
       выше своей ширины, а страница — в десять, и настоящий раствор увёл бы
       стенки прямо в текст. */
    function profile(t) {
      var s = clamp(t / 0.38, 0, 1);
      s = s * s * (3 - 2 * s);
      var w = 1 - 0.15 * s;
      if (t > 0.93) {
        var f = clamp((t - 0.93) / 0.05, 0, 1);
        f = f * f * (3 - 2 * f);
        w += 0.1 * f;
      }
      return w;
    }

    /* Полуширина бокала на строке y (координаты холста) */
    function wall(y, m) {
      return W / 2 * profile(clamp((y - m.top) / m.height, 0, 1));
    }

    /* Ломаная вдоль стенки: шаг 12px, силуэт всё равно почти прямой. Пишет в
       любой приёмник с lineTo — и в контекст, и в Path2D. */
    function wallPath(p, m, side, shift, from, to, back) {
      var y, step = back ? -12 : 12;
      for (y = from; back ? y > to : y < to; y += step) {
        p.lineTo(W / 2 + side * (wall(y, m) - shift), y);
      }
      p.lineTo(W / 2 + side * (wall(to, m) - shift), to);
    }

    /* Пузырьки в пиве: на фото их сотни, поэтому считаем от площади поля.
       Мелких должно быть заметно больше крупных — отсюда квадрат случайной
       величины и в радиусе, и в скорости. */
    function makeBubbles() {
      var span = X1 - X0, depth = YBOT - YTOP;
      var count = clamp(Math.round(span * depth / 260), 200, 820);
      bubbles.length = 0;
      for (var i = 0; i < count; i++) {
        var rr = Math.random();
        bubbles.push({
          x: X0 + Math.random() * span,
          y: YTOP + Math.random() * depth,
          r: (0.8 + rr * rr * 4.6) * u,
          v: (0.18 + rr * 1.15) * u,        // крупные всплывают быстрее
          a: 0.3 + Math.random() * 0.5
        });
      }
    }

    /* Пена не течёт: её фактура стоит на месте относительно жидкости, поэтому
       рисуется один раз в отдельный холст и потом просто кладётся картинкой.
       Иначе тысячу ячеек пришлось бы перерисовывать каждый кадр. Снизу холст
       заходит за линию покоя на пару десятков пикселей — там живёт шипучая
       кромка, и волна не должна открывать под пеной дырку. */
    function buildFoam() {
      var over = 18 * u;
      foamDeep = CW * FOAM_AT + Math.max(W, H) * 0.24;
      foamW = X1 - X0;
      foamH = foamDeep + over;
      foamCv.width = Math.round(foamW * dpr);
      foamCv.height = Math.round(foamH * dpr);

      var f = foamCv.getContext('2d');
      f.setTransform(dpr, 0, 0, dpr, 0, 0);
      var g = f.createLinearGradient(0, foamH - CW * 0.55, 0, foamH);
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
           как грязь. */
        var shade = dy < CW * 0.15 && Math.random() < 0.32;
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

    /* ---------------------------------------------------------------- кадр */
    /* Сцена рисуется плоской в отдельный холст, а на экран попадает уже через
       compose() — иначе искажение у бортов пришлось бы закладывать в каждую
       кривую отдельно. */
    function paint(amp) {
      var m = marks(), y0 = m.surface, step = 14 * u;
      var x, k;

      sctx.setTransform(dpr, 0, 0, dpr, EXTRA * dpr, 0);
      sctx.clearRect(-EXTRA, 0, W + 2 * EXTRA, H);

      sctx.save();
      sctx.translate(W / 2, H * 0.5);
      sctx.rotate(angle * Math.PI / 180);
      sctx.translate(-W / 2, -H * 0.5);

      /* пиво заливает всё ниже линии пены и уходит за нижний край поля */
      var top = Math.max(YTOP, Math.min(y0, YBOT));
      sctx.beginPath();
      sctx.moveTo(X0, y0 + wave(X0, amp));
      for (x = X0 + step; x < X1; x += step) sctx.lineTo(x, y0 + wave(x, amp));
      sctx.lineTo(X1, y0 + wave(X1, amp));
      sctx.lineTo(X1, YBOT);
      sctx.lineTo(X0, YBOT);
      sctx.closePath();
      var grad = sctx.createLinearGradient(0, top, 0, top + CW * 2.2);
      grad.addColorStop(0, COLOR.beerTop);
      grad.addColorStop(0.4, COLOR.beerMid);
      grad.addColorStop(1, COLOR.beerLow);
      sctx.fillStyle = grad;
      sctx.fill();

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

      /* Пена и её кромка — только когда граница вообще близко к экрану: ниже по
         странице рисовать нечего, там сплошное пиво. */
      if (y0 > YTOP - foamDeep && y0 < YBOT) {
        sctx.drawImage(foamCv, X0, y0 - foamDeep, foamW, foamH);

        /* пена не обрывается по линейке: вдоль самой волны сажаем живые кружки —
           они и цепляются за пиво, когда оно уходит вбок */
        var seed = 1;
        for (x = X0; x < X1; x += 9 * u) {
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
      }

      sctx.restore();
      compose(m);
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
    function compose(m) {
      var S = SIDE, E = EXTRA;
      var lift = H * 0.02;
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

      bottomGlass(m);
      silhouette(m);
      veil(m);
      walls(m);
      topRim(m);
    }

    /* Всё за стенками — уже не бокал, там бумага бланка. Выше венчика стекла
       нет вовсе: там пена вспучена куполом, и всё за куполом тоже стирается —
       иначе шапка выходит за кромки прямоугольником. */
    function silhouette(m) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';   // destination-out стирает по альфе источника
      var side, edge;
      for (side = -1; side <= 1; side += 2) {
        edge = side < 0 ? -2 : W + 2;
        ctx.beginPath();
        ctx.moveTo(edge, -2);
        wallPath(ctx, m, side, 0, -2, H + 2, false);
        ctx.lineTo(edge, H + 2);
        ctx.closePath();
        ctx.fill();
      }
      if (m.rim > -CW && m.rim < H + CW) {
        var half = wall(m.rim, m), dome = CW * 0.1;
        ctx.beginPath();
        ctx.moveTo(-2, -CW);
        ctx.lineTo(W + 2, -CW);
        ctx.lineTo(W + 2, m.rim);
        ctx.lineTo(W / 2 + half, m.rim);
        ctx.quadraticCurveTo(W / 2, m.rim - dome * 2, W / 2 - half, m.rim);
        ctx.lineTo(-2, m.rim);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    /* Стекло стенки: у самого борта смотришь сквозь всю толщу пива — там оно
       гуще и темнее, а чуть внутрь стекло ловит свет длинным бликом. Полоса
       идёт вдоль силуэта, поэтому на сужении она уезжает вместе со стенкой. */
    function walls(m) {
      var band = W * 0.17;
      var mid = wall(H / 2, m);
      var top = Math.max(m.rim, -2);            // выше венчика стекла нет
      var full = clamp(Math.max(top, m.surface), top, H + 2);
      var steps = 18, i, y0, y1;

      for (var side = -1; side <= 1; side += 2) {
        var x0 = W / 2 + side * mid;
        var g = ctx.createLinearGradient(x0, 0, x0 - side * band, 0);
        g.addColorStop(0, 'rgba(96,48,4,.42)');
        g.addColorStop(0.22, 'rgba(126,68,10,.12)');
        g.addColorStop(0.44, 'rgba(255,255,255,.24)');
        g.addColorStop(0.72, 'rgba(255,255,255,0)');

        var p = new Path2D();
        p.moveTo(W / 2 + side * wall(top, m), top);
        wallPath(p, m, side, 0, top, H + 2, false);
        wallPath(p, m, side, band, H + 2, top, true);
        p.closePath();

        ctx.fillStyle = g;
        /* Тень у борта — это толща пива, а над его поверхностью её нет: за
           стеклом там пена. Поэтому от венчика к линии пива плотность
           набирается полосами, иначе тень начиналась бы ступенькой. */
        for (i = 0; i < steps && full > top; i++) {
          /* границы округляем: полосы должны стыковаться пиксель в пиксель,
             иначе на нахлёсте видна тёмная линия, а в зазоре — светлая */
          y0 = Math.round(top + (full - top) * i / steps);
          y1 = Math.round(top + (full - top) * (i + 1) / steps);
          if (y1 <= y0) continue;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, y0, W, y1 - y0);
          ctx.clip();
          ctx.globalAlpha = (i + 0.5) / steps;
          ctx.fill(p);
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, Math.round(full), W, H + 4 - Math.round(full));
        ctx.clip();
        ctx.fill(p);
        ctx.restore();
      }
    }

    /* Венчик: устье бокала стоит выше линии пены, пена над ним вспучена шапкой.
       Ближняя кромка ярче дальней — на неё падает свет. */
    function topRim(m) {
      var y = m.rim;
      if (y < -CW || y > H + CW * 0.4) return;
      var half = wall(y, m), ry = half * 0.14;
      ctx.save();
      ctx.lineWidth = Math.max(1.5, 3 * u);
      /* Кромку по белой пене одним белым не увидеть, поэтому ближняя идёт
         светлой линией с тёплой тенью под ней, а дальняя — только тенью. */
      /* Дальней кромки не рисуем вовсе: за ней непрозрачная пена, сквозь неё
         край бокала не просвечивает. */
      ctx.beginPath();
      ctx.ellipse(W / 2, y + ry * 0.12, half, ry, 0, 0, Math.PI);
      ctx.strokeStyle = 'rgba(176,144,92,.34)';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(W / 2, y, half, ry, 0, 0, Math.PI);          // ближняя
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.stroke();
      ctx.restore();
    }

    /* Донышко: жидкость обрывается дугой, ниже идёт толстое стекло. Рисуется
       уже после искажения бортами — стекло приклеено к экрану и не наклоняется
       вместе с пивом. */
    function bottomGlass(m) {
      var bowl = m.base;
      if (bowl > H + CW * 0.4 || bowl < -CW * 0.4) return;
      var dep = CW * 0.1;           // насколько провисает середина
      var thick = CW * 0.055;       // толщина донышка
      var half = wall(bowl, m) + 2;

      function arc(y) {
        ctx.moveTo(W / 2 - half, y);
        ctx.quadraticCurveTo(W / 2, y + dep * 2, W / 2 + half, y);
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

      /* у самого дна пиво густеет */
      ctx.save();
      ctx.beginPath();
      arc(bowl);
      ctx.lineTo(W / 2 + half, bowl - CW * 0.55);
      ctx.lineTo(W / 2 - half, bowl - CW * 0.55);
      ctx.closePath();
      var gd = ctx.createLinearGradient(0, bowl - CW * 0.55, 0, bowl + dep);
      gd.addColorStop(0, 'rgba(210,142,27,0)');
      gd.addColorStop(1, 'rgba(184,116,12,.55)');
      ctx.fillStyle = gd;
      ctx.fill();
      ctx.restore();

      /* стекло между дугой жидкости и внешней дугой дна */
      ctx.beginPath();
      arc(bowl);
      ctx.lineTo(W / 2 + half, bowl + thick);
      ctx.quadraticCurveTo(W / 2, bowl + thick + dep * 2, W / 2 - half, bowl + thick);
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

    /* Забеливающая вуаль: под текстом пиво нужно погасить, иначе бланк не
       читается. У пены и у донышка вуали нет — там пиво во всю силу. */
    function veil(m) {
      var a = m.surface + CW * 0.1;    // ниже пены вуаль набирает силу
      var b = m.surface + CW * 0.7;
      var c = m.base - CW * 0.7;       // к донышку сходит на нет
      var e = m.base - CW * 0.12;
      if (b > c) { b = c = (b + c) / 2; }

      function at(y) { return clamp(y / H, 0, 1); }
      var g = ctx.createLinearGradient(0, 0, 0, H);
      var stops = [[at(a), 0], [at(b), VEIL], [at(c), VEIL], [at(e), 0]];
      for (var i = 1; i < stops.length; i++) {
        if (stops[i][0] < stops[i - 1][0]) stops[i][0] = stops[i - 1][0];
      }
      for (i = 0; i < stops.length; i++) {
        g.addColorStop(stops[i][0], 'rgba(' + COLOR.veil + ',' + stops[i][1] + ')');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
    else window.addEventListener('resize', resize);

    /* ------------------------------------------------------- статичный режим */
    if (reduce) {
      paint(0);
      window.addEventListener('scroll', function () { paint(0); }, { passive: true });
      return;
    }

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

      var amp = Math.min(9 * u, (1.1 + Math.abs(vel) * 2.6) * u);

      /* Пузырьки упираются в поверхность, а если она уже уехала за верх экрана —
         просто уходят за край поля и заводятся снизу заново. */
      var ceil = Math.max(YTOP, marks().surface);
      for (k = 0; k < bubbles.length; k++) {
        var b = bubbles[k];
        b.y -= b.v * steps;
        b.x += Math.sin(t / 900 + k) * 0.2 * u;
        if (b.y < ceil + b.r) {
          b.y = YBOT - Math.random() * H * 0.15;
          b.x = X0 + Math.random() * (X1 - X0);
        }
      }

      paint(amp);

      if (hintShown && !hintHidden && t - born > 12000) hideHint();
      requestAnimationFrame(frame);
    }

    /* Считать кадры под свёрнутой вкладкой незачем — это расход батареи. */
    function setRunning(on) {
      if (on === running) return;
      running = on;
      if (on) { last = now(); requestAnimationFrame(frame); }
    }
    document.addEventListener('visibilitychange', function () { setRunning(!document.hidden); });

    paint(1.1 * u);
    requestAnimationFrame(frame);
  }

  /* Точка монтирования приезжает вместе с рендером компонента (support.js), а он
     стартует после нас — поэтому ждём её появления, а не хватаем сразу. */
  function waitForMount() {
    var tries = 0;
    var timer = setInterval(function () {
      var host = document.querySelector('[data-beer-glass]');
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
