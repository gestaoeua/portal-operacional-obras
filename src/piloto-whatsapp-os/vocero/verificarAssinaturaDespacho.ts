// Verificação FAIL-CLOSED da assinatura do despacho, fiel ao contrato lido em
// specs/021-despacho-estandar/contracts/despacho.md: HMAC-SHA256 do CORPO CRU
// (string, antes de qualquer parse de JSON), em hex, com prefixo `sha256=`,
// comparada em tempo constante. O mesmo padrão que o próprio repositório usa
// no seu arnês de teste (`scripts/e2e-despacho.mjs`, só lido, nunca executado
// nesta sessão): `sha256=${createHmac('sha256', chave).update(cru).digest('hex')}`
// com `timingSafeEqual`.
//
// Esta função NUNCA lança erro — entrada ausente, malformada, de tamanho
// diferente, ou um segredo vazio resultam sempre em rejeição (fail-closed),
// nunca em exceção nem em "autorizado por omissão".
import { createHmac, timingSafeEqual } from 'node:crypto';

export type ResultadoVerificacaoAssinatura =
  | { valida: true }
  | { valida: false; motivo: string };

const PREFIXO_ASSINATURA = 'sha256=';

/**
 * Calcula a assinatura esperada para um corpo cru com um segredo — NUNCA
 * chamar isto com um segredo "de produção": esta função não sabe, e não deve
 * saber, se o segredo que recebeu é real ou de teste. Quem chama decide isso
 * (ver `SEGREDO_HMAC_DE_TESTE_NUNCA_REAL` em `fixturesVoceroFicticias.ts`,
 * explicitamente nomeado como fictício).
 */
function calcularAssinaturaEsperada(corpoCru: string, segredoHmac: string): string {
  return PREFIXO_ASSINATURA + createHmac('sha256', segredoHmac).update(corpoCru, 'utf8').digest('hex');
}

/**
 * Verifica `cabecalhoAssinatura` (o valor bruto do header `X-Vocero-Signature`)
 * contra `corpoCru` (os bytes/string EXATOS recebidos, antes de qualquer
 * parse) usando `segredoHmac`. Fail-closed: qualquer ausência, formato
 * errado, tamanho diferente ou mismatch é `valida:false`, sem lançar erro.
 */
export function verificarAssinaturaDespacho(
  corpoCru: string,
  cabecalhoAssinatura: string | undefined,
  segredoHmac: string | undefined
): ResultadoVerificacaoAssinatura {
  if (!segredoHmac) {
    return { valida: false, motivo: 'nenhum segredo HMAC foi fornecido a esta verificação — fail-closed, nunca autorizado por omissão' };
  }
  if (!cabecalhoAssinatura) {
    return { valida: false, motivo: "cabeçalho de assinatura (X-Vocero-Signature) ausente" };
  }
  if (!cabecalhoAssinatura.startsWith(PREFIXO_ASSINATURA)) {
    return { valida: false, motivo: `cabeçalho de assinatura não começa com '${PREFIXO_ASSINATURA}'` };
  }

  const hexRecebido = cabecalhoAssinatura.slice(PREFIXO_ASSINATURA.length);
  if (!/^[0-9a-f]+$/i.test(hexRecebido)) {
    return { valida: false, motivo: 'parte hexadecimal da assinatura contém caracteres inválidos' };
  }

  const esperada = calcularAssinaturaEsperada(corpoCru, segredoHmac).slice(PREFIXO_ASSINATURA.length);

  // timingSafeEqual LANÇA se os buffers tiverem tamanhos diferentes — isso
  // violaria "nunca lança erro", então o tamanho é checado ANTES de chamá-la.
  const bufEsperado = Buffer.from(esperada, 'hex');
  const bufRecebido = Buffer.from(hexRecebido, 'hex');
  if (bufEsperado.length !== bufRecebido.length) {
    return { valida: false, motivo: 'assinatura com tamanho diferente do esperado' };
  }

  const bate = timingSafeEqual(bufEsperado, bufRecebido);
  if (!bate) {
    return { valida: false, motivo: 'assinatura não corresponde ao corpo cru com o segredo fornecido' };
  }
  return { valida: true };
}
