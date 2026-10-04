// Autorização por projeto — correção obrigatória 3 da entrega de código,
// revisada após o apontamento do Guardian na primeira fatia.
//
// CORREÇÃO: a versão anterior liberava automaticamente o caso de "0 ou 1
// projeto ativo" sem exigir vínculo explícito — isso não atende "somente
// projetos autorizados" (um usuário via o único projeto existente só por
// ele ser o único, não porque alguém o autorizou para esse projeto). Essa
// brecha foi removida: a partir de agora, a autorização SEMPRE exige a
// lista explícita (`projetosAutorizados`) no usuário, mesmo com zero ou um
// projeto ativo. Sem essa lista, bloqueia — sempre, sem exceção por
// contagem de projetos.
//
// [FATO, confirmado no próprio Code.gs/README deste repositório]: hoje não
// existe nenhum vínculo entre `Usuarios` e `Projetos` na planilha real (a
// aba `Projetos` existe só como estrutura, nunca lida por doGet/doPost) —
// não posso reaproveitar o que não existe, e não vou inventar uma
// concessão de acesso só porque o perfil é gestor/diretor ou porque há
// poucos projetos cadastrados.
import type { AutorizacaoProjetos, OrdemServico } from './types';

export interface ProjetoRegistro {
  projetoId: string;
  ativo: boolean;
}

export interface UsuarioAutorizacao {
  usuario: string;
  perfil: 'executor' | 'gestor' | 'diretor';
  /**
   * Lista explícita de projetos autorizados. `undefined` = vínculo ausente
   * (bloqueia). `[]` = vínculo existe, mas autoriza zero projetos (também
   * resulta em nenhum dado, mas é um bloqueio DIFERENTE — ver `ok`/`bloqueio`
   * abaixo: `[]` explícito é `ok:true` com lista vazia, não um erro).
   */
  projetosAutorizados?: string[];
}

export interface AutorizacaoProvider {
  obterProjetosAtivos(): Promise<ProjetoRegistro[]>;
  obterUsuario(usuarioId: string): Promise<UsuarioAutorizacao | undefined>;
}

/**
 * Resolve a lista de projetos que um usuário pode ver. NUNCA concede
 * projeto algum sem o vínculo explícito `projetosAutorizados` no usuário —
 * inclusive quando há zero ou um projeto ativo cadastrado. A única exceção
 * (não é exceção de verdade, é o mesmo caminho) é `projetosAutorizados: []`
 * explícito, que autoriza explicitamente "nenhum" — diferente de ausência
 * de configuração, que bloqueia com um código de erro específico.
 */
export async function resolverProjetosAutorizados(
  usuarioId: string,
  provider: AutorizacaoProvider
): Promise<AutorizacaoProjetos> {
  const usuario = await provider.obterUsuario(usuarioId);
  if (!usuario) {
    return {
      ok: false,
      projetosAutorizados: [],
      bloqueio: 'SESSAO_INVALIDA',
      motivoBloqueio: 'Usuário não encontrado para a sessão informada.',
    };
  }

  if (usuario.projetosAutorizados === undefined) {
    return {
      ok: false,
      projetosAutorizados: [],
      bloqueio: 'AUTORIZACAO_PROJETO_NAO_CONFIGURADA',
      motivoBloqueio:
        'A planilha ainda não tem a coluna "ProjetosAutorizados" preenchida para este usuário em Usuarios. ' +
        'Nenhum projeto é liberado por padrão — nem mesmo quando há só um projeto cadastrado — até essa coluna existir.',
    };
  }

  const ativos = (await provider.obterProjetosAtivos()).filter((p) => p.ativo);
  const idsAtivos = new Set(ativos.map((p) => p.projetoId));
  const autorizados = usuario.projetosAutorizados.filter((id) => idsAtivos.has(id));
  return { ok: true, projetosAutorizados: autorizados };
}

/**
 * Filtra OS já normalizadas pela lista de projetos autorizados — correção
 * da brecha da primeira fatia, que deixava passar qualquer OS sem
 * `projetoId` (pensando em "projeto único implícito", removido acima).
 * Agora, OS sem `projetoId` NUNCA passam por padrão — entram no contador
 * `semProjetoAtribuido`, mostrado explicitamente na tela (nunca escondido
 * nem contado como "zero confirmado"), para que fique claro que a
 * associação está faltando, não que não há OS nenhuma.
 */
export function filtrarOrdensPorAutorizacao(
  ordens: OrdemServico[],
  projetosAutorizados: string[]
): { autorizadas: OrdemServico[]; semProjetoAtribuido: number } {
  const permitido = new Set(projetosAutorizados);
  let semProjetoAtribuido = 0;
  const autorizadas = ordens.filter((o) => {
    if (!o.projetoId) {
      semProjetoAtribuido += 1;
      return false;
    }
    return permitido.has(o.projetoId);
  });
  return { autorizadas, semProjetoAtribuido };
}

/** Adaptador de fixtures — só para testes/prévia, nunca para dado real. Ver `fixtures.ts`. */
export class AutorizacaoProviderDemo implements AutorizacaoProvider {
  constructor(
    private readonly projetos: ProjetoRegistro[],
    private readonly usuarios: UsuarioAutorizacao[]
  ) {}
  async obterProjetosAtivos(): Promise<ProjetoRegistro[]> {
    return this.projetos;
  }
  async obterUsuario(usuarioId: string): Promise<UsuarioAutorizacao | undefined> {
    return this.usuarios.find((u) => u.usuario === usuarioId);
  }
}
