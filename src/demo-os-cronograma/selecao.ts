// Mapeamento puro de "clique numa barra/linha" -> OS a detalhar.
//
// Extraído como função pura (em vez de só lógica dentro do componente)
// para ser testável diretamente: a exigência era garantir que o clique
// sempre abre exatamente a OS clicada, mesmo quando a lista contém OS de
// teste, de outro projeto, ou com o mesmo prefixo de identificador.
import type { OrdemServico } from './types';

export function selecionarOsPorClique(osId: string, todas: OrdemServico[]): OrdemServico | undefined {
  return todas.find((o) => o.os === osId);
}
