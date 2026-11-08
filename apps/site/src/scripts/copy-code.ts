document.querySelectorAll<HTMLElement>('pre > code').forEach((code, index) => {
  const pre = code.parentElement!
  // ponytail: Universe already owns its prompt controls and permission reminders.
  if (pre.closest('.prompt-area')) return
  if (!code.id) code.id = `copy-code-${index}`
  const toolbar = document.createElement('div')
  toolbar.className = 'code-copy'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Copy code'
  button.setAttribute('aria-controls', code.id)
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  toolbar.append(button, status)
  pre.before(toolbar)

  button.addEventListener('click', async () => {
    button.disabled = true
    status.textContent = ''
    try {
      await navigator.clipboard.writeText(code.textContent ?? '')
      status.textContent = 'Copied.'
    } catch {
      const range = document.createRange()
      range.selectNodeContents(code)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      status.textContent = 'Clipboard unavailable. Select and copy the code manually.'
    } finally {
      button.disabled = false
    }
  })
})
