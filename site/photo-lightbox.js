// Тап по фото открывает его целиком поверх страницы: в вёрстке картинки
// обрезаны под плитку (object-fit: cover), и на телефоне иначе не разглядеть
// ни лофт, ни подарок из вишлиста.
//
// Открываемые картинки помечаются в разметке атрибутом data-zoom — скрипт
// ничего не угадывает по селекторам. Подпись берётся из data-zoom-caption.
// Пока оверлей открыт, шлём photo-lightbox:open / :close — по ним компонент
// останавливает автопрокрутку карусели, иначе после закрытия под пальцем
// окажется уже другой кадр.
(function () {
  'use strict';

  var overlay = null;
  var imgEl = null;
  var capEl = null;
  var scrollLock = '';

  function build() {
    overlay = document.createElement('div');
    overlay.setAttribute('data-photo-lightbox', '1');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position: fixed', 'inset: 0', 'z-index: 60', 'display: none',
      'align-items: center', 'justify-content: center',
      'flex-direction: column', 'gap: 14px',
      'padding: 24px 18px calc(24px + env(safe-area-inset-bottom))',
      'background: rgba(34,26,20,.92)',
      '-webkit-backdrop-filter: blur(6px)', 'backdrop-filter: blur(6px)',
      'cursor: zoom-out', 'overscroll-behavior: contain'
    ].join('; ');

    imgEl = document.createElement('img');
    imgEl.alt = '';
    imgEl.draggable = false;
    imgEl.style.cssText = [
      'max-width: 100%', 'max-height: 82vh', 'display: block',
      'border-radius: 3px', 'object-fit: contain',
      'box-shadow: 0 18px 60px rgba(0,0,0,.45)'
    ].join('; ');

    capEl = document.createElement('p');
    capEl.style.cssText = [
      'margin: 0', 'max-width: 34ch', 'text-align: center',
      "font-family: 'Manrope', sans-serif", 'font-weight: 300',
      'font-size: 13px', 'line-height: 1.6', 'color: rgba(251,248,242,.78)'
    ].join('; ');

    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть');
    close.textContent = '✕';
    close.style.cssText = [
      'position: absolute', 'top: calc(14px + env(safe-area-inset-top))', 'right: 14px',
      'width: 44px', 'height: 44px', 'display: flex',
      'align-items: center', 'justify-content: center',
      'border-radius: 999px', 'background: rgba(247,243,236,.14)',
      'border: 1px solid rgba(251,248,242,.35)',
      'font-size: 16px', 'color: #FBF8F2', 'cursor: pointer'
    ].join('; ');
    close.addEventListener('click', hide);

    overlay.appendChild(imgEl);
    overlay.appendChild(capEl);
    overlay.appendChild(close);
    // Клик мимо картинки закрывает; по самой картинке — нет, чтобы случайный
    // тап при разглядывании не схлопывал просмотр.
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
    imgEl.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(overlay);
  }

  function show(src, caption) {
    if (!src) return;
    if (!overlay) build();
    imgEl.src = src;
    capEl.textContent = caption || '';
    capEl.style.display = caption ? '' : 'none';
    overlay.style.display = 'flex';
    scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (overlay.animate) {
      overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      imgEl.animate(
        [{ transform: 'scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 320, easing: 'cubic-bezier(.22,.7,.25,1)' }
      );
    }
    document.addEventListener('keydown', onKey);
    document.dispatchEvent(new CustomEvent('photo-lightbox:open'));
  }

  function hide() {
    if (!overlay || overlay.style.display === 'none') return;
    overlay.style.display = 'none';
    imgEl.removeAttribute('src');
    document.body.style.overflow = scrollLock;
    document.removeEventListener('keydown', onKey);
    document.dispatchEvent(new CustomEvent('photo-lightbox:close'));
  }

  function onKey(e) { if (e.key === 'Escape') hide(); }

  // Источник: у <img> берём реально загруженный кадр, у <image-slot> —
  // атрибут src (сама картинка живёт в его shadow DOM).
  function srcOf(el) {
    if (el.tagName === 'IMG') return el.currentSrc || el.src;
    var inner = el.shadowRoot && el.shadowRoot.querySelector('img');
    return el.getAttribute('src') || (inner && inner.src) || '';
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-zoom]');
    if (!el) return;
    e.preventDefault();
    show(srcOf(el), el.getAttribute('data-zoom-caption'));
  });
})();
