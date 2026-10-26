// Decide SÓ a elegibilidade para criação AUTOMÁTICA de rascunho de OS. Esta
// função NUNCA cria, persiste nem conecta a nenhum backend/rascunho real —
// ela só retorna uma decisão de dados (ver verificação estrutural em
// `__tests__/semBackendReal.test.ts`, que confirma que nem este arquivo nem
// o resto do submódulo `webhookRecebido/` fazem chamada de rede ou importam
// o criador de rascunhos). Ligar isto a um backend/persistência real é um
// passo FUTURO e deliberadamente NÃO feito aqui.
import type { DecisaoIngestaoAutomatica, MetadadosAuditoriaIngestao } from './tipos';

function obterStringSegura(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function obterNumeroSeguro(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function obterBooleanoSeguro(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Extrai, com segurança (nunca lança erro), só o que for possível OBSERVAR
 * de uma entrada arbitrária — `null`, `undefined`, string, array, objeto
 * malformado, ou um `EventoTextoPrivadoNormalizado` de verdade. Nenhum
 * campo ausente ou do tipo errado vira erro: fica simplesmente `undefined`
 * no resultado. Isto é um registro de auditoria, não uma confirmação.
 */
function observarMetadadosParaAuditoria(entrada: unknown): MetadadosAuditoriaIngestao {
  const objeto: Record<string, unknown> = typeof entrada === 'object' && entrada !== null ? (entrada as Record<string, unknown>) : {};
  return {
    instanceId: obterStringSegura(objeto.instanceId),
    messageId: obterStringSegura(objeto.messageId),
    remetenteId: obterStringSegura(objeto.remetenteId),
    momentoUnix: obterNumeroSeguro(objeto.momentoUnix),
    fromMe: obterBooleanoSeguro(objeto.fromMe),
    autenticidadeObservada: obterStringSegura(objeto.autenticidade),
  };
}

/**
 * FAIL-CLOSED DEFINITIVO (correção de segurança, 3ª e última rodada desta
 * salvaguarda). A entrada é tratada como `unknown` de propósito: um tipo
 * TypeScript não garante nada em runtime, então esta função não confia no
 * tipo declarado em outros arquivos — ela valida de novo, defensivamente,
 * e nunca lança erro, mesmo recebendo `null`, `undefined`, um objeto
 * malformado, ou um valor de autenticidade ausente/desconhecido/forjado
 * (alguém tentando simular um status "verificado" que este módulo não
 * implementa).
 *
 * Não existe, NESTA FUNÇÃO, nenhum caminho de código que resulte em uma
 * decisão positiva. Isto vale para:
 *   - fromMe:true (eco) — política desta aplicação, não do fornecedor;
 *   - autenticidade 'NAO_VERIFICADA' confirmada (o caso "normal" hoje,
 *     gate G1 — ver tipos.ts);
 *   - e qualquer outra coisa — entrada malformada, ausente, ou com um
 *     valor de autenticidade diferente do esperado.
 * Todos os três casos acima resultam na mesma coisa: não elegível. Essa
 * decisão é permanente nesta função até existir, de verdade, um mecanismo
 * de autenticação real aprovado — o que exigiria editar deliberadamente
 * este arquivo depois de confirmar isso contra a documentação oficial do
 * fornecedor. Nenhum valor fictício de autenticação verificada, nem
 * nenhum verificador do fornecedor, foi criado para abrir esse caminho
 * antes disso. Uma eventual simulação offline de "como seria se existisse
 * autenticidade verificada" deve viver só em código de teste, explicitamente
 * nomeado como simulação — nunca nesta função.
 *
 * Metadados de auditoria são sempre preservados quando possível, para
 * investigação manual depois — nunca usados para conceder elegibilidade.
 */
export function decidirIngestaoAutomatica(entrada: unknown): DecisaoIngestaoAutomatica {
  const auditoria = observarMetadadosParaAuditoria(entrada);

  if (auditoria.fromMe === true) {
    return {
      elegivel: false,
      motivo:
        'eco de mensagem enviada pela própria instância conectada (fromMe:true) — ' +
        'ignorado/quarentenado para criação automática de rascunho por política desta ' +
        'aplicação (decisão de produto nossa, não garantia nem filtro do fornecedor W-API)',
      auditoria,
    };
  }

  if (auditoria.autenticidadeObservada === 'NAO_VERIFICADA') {
    return {
      elegivel: false,
      motivo:
        'autenticidade do callback ainda não verificada (gate G1) — nenhum evento é elegível ' +
        'para criação automática de rascunho enquanto isso não for confirmado contra a ' +
        'documentação oficial do provedor; a ausência atual de um backend real não substitui ' +
        'esta salvaguarda',
      auditoria,
    };
  }

  // Qualquer outra coisa: entrada nula/indefinida, malformada, sem o campo
  // de autenticidade, ou com um valor diferente do esperado (inclusive uma
  // string forjada tentando simular um status "verificado" inexistente).
  // Fail-closed, sem lançar erro, sem conceder elegibilidade.
  return {
    elegivel: false,
    motivo:
      'entrada não reconhecida como um evento normalizado confiável (ausente, malformada, ou com ' +
      'autenticidade desconhecida/forjada) — tratada como não elegível por padrão (fail-closed)',
    auditoria,
  };
}
