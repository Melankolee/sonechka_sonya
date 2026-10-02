// «Save to Files» — запасной путь на случай, если что-то случится с хранилищем
// приложения: файл уходит в системный Share Sheet, оттуда «Сохранить в Файлы».
// Основной офлайн это не заменяет.
//
// navigator.share должен вызываться прямо из обработчика нажатия (Safari
// требует жест пользователя), поэтому File готовится заранее, при открытии
// документа, а здесь никаких await до share нет.

export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}

export function saveToFiles(file: File): void {
  if (canShareFile(file)) {
    navigator.share({ files: [file], title: file.name }).catch(() => {
      // Закрытый Share Sheet — не ошибка.
    })
    return
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
