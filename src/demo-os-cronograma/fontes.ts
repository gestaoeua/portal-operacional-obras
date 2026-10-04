// Controlador de sequência por fonte — protege contra resposta fora de
// ordem E contra troca de OS/projeto/usuário (correção 6 do complemento:
// a sequência precisa estar vinculada ao contexto da consulta atual, não
// só a um número crescente isolado).
//
// Cada fonte (Salas, OS, Cronograma, QuickBooks, WhatsApp...) é lida de
// forma independente — nenhuma leitura lenta ou com erro bloqueia as
// demais. Isso é responsabilidade de quem chama (ver `osApi.ts`), não
// deste controlador, que só decide se uma resposta pode ser aplicada.
export interface ContextoConsulta {
  usuario: string;
  projetoId: string;
  recurso: string; // ex.: 'os', 'cronograma', 'salas'
}

/** Exportada para quem precisa comparar "é ainda o contexto ativo?" fora
 * deste módulo (ver App.tsx — correção obrigatória: o controlador sozinho
 * não impede uma resposta tardia de um contexto com uma ÚNICA requisição
 * de ser aplicada depois de uma troca; é preciso também comparar contra o
 * contexto atualmente ativo, não só a sequência dentro do próprio contexto). */
export function chaveContexto(c: ContextoConsulta): string {
  return `${c.usuario}::${c.projetoId}::${c.recurso}`;
}

interface RegistroContexto {
  ultimaSequenciaAplicada: number;
}

export class ControladorDeSequencia {
  private readonly registros = new Map<string, RegistroContexto>();
  private proximaSequencia = 1;

  /** Chamar ao DISPARAR uma requisição — devolve o número a carregar nela. */
  novaRequisicao(): number {
    return this.proximaSequencia++;
  }

  /**
   * Chamar ao RECEBER uma resposta. Devolve true só quando a resposta deve
   * ser aplicada à tela: mesmo contexto exato (usuário+projeto+recurso) e
   * sequência maior ou igual à última já aplicada para esse contexto.
   * Uma troca de projeto/usuário/recurso é, por definição, um contexto novo
   * — a sequência de um contexto anterior nunca é comparada com a de outro.
   */
  podeAplicar(contexto: ContextoConsulta, sequencia: number): boolean {
    const chave = chaveContexto(contexto);
    const registro = this.registros.get(chave);
    if (!registro) {
      this.registros.set(chave, { ultimaSequenciaAplicada: sequencia });
      return true;
    }
    if (sequencia < registro.ultimaSequenciaAplicada) return false; // atrasada — descartada em silêncio
    registro.ultimaSequenciaAplicada = sequencia;
    return true;
  }

  /** Usado nos testes de troca de usuário: limpa o estado de um contexto específico. */
  esquecerContexto(contexto: ContextoConsulta): void {
    this.registros.delete(chaveContexto(contexto));
  }
}
