export function installSafeDocumentAnchors(md) {
  // Legacy documents use empty named anchors. Permit only that exact form;
  // all other source HTML remains disabled by Markdown-It.
  md.inline.ruler.before('html_inline', 'safe_document_anchor', (state, silent) => {
    const match = /^<a id="([A-Za-z][A-Za-z0-9_-]*)"><\/a>/.exec(
      state.src.slice(state.pos),
    )
    if (!match) return false
    if (!silent) {
      const token = state.push('safe_document_anchor', 'a', 0)
      token.attrSet('id', match[1])
    }
    state.pos += match[0].length
    return true
  })
  md.renderer.rules.safe_document_anchor = (tokens, index) =>
    `<a id="${md.utils.escapeHtml(tokens[index].attrGet('id'))}"></a>`
}
