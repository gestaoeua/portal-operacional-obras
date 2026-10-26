// Presentation override for the local, memory-only fixture. NEVER DEPLOY.
const fixtureSuccess = 'Resposta da simulação local — dados fictícios em memória, sem gravação na planilha real.';
function fixturePresentation(html) {
  const original = 'Resposta confirmada pelo backend privado.';
  if (!html.includes(original)) throw Error('Fixture success message target changed; review presentation.');
  return html.replaceAll(original, fixtureSuccess);
}
module.exports = { fixturePresentation, fixtureSuccess };
