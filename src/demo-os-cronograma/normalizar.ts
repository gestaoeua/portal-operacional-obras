// Normalização de OS — extraído de `osApi.ts` (branch de desenvolvimento,
// não publicada) especificamente para esta demo pública.
//
// ISOLAMENTO DELIBERADO (auditoria de publicação desta demo): o
// `osApi.ts` original também contém `buscar()`/`carregarOrdens()`, que
// importa a URL real do Apps Script de `src/config.ts` (o endpoint já
// implantado do portal de Salas) só para fazer a chamada de rede — esta
// demo NUNCA faz essa chamada (usa só `fixtures.ts`). Para garantir que
// nenhuma URL real, nenhum import de configuração real e nenhuma função de
// rede entre no bundle público desta demo, este arquivo contém SÓ a parte
// pura de normalização (nenhum `fetch`, nenhum `import` de `../config` ou
// de qualquer módulo fora de `./`). O mesmo normalizador é reaproveitado
// aqui, nunca uma reimplementação paralela — só isolado do cliente de rede.
import type { DuracaoPlanejada, OrdemServico, UnidadeDuracao } from './types';
import { classificarStatus, temEtapaAplicavel } from './statusContract';
import { parseDiaLocal } from './diaLocal';
import { validarDuracao } from './duracao';

export interface RawOS {
  OS?: string;
  Endereco?: string;
  Cidade?: string;
  Status?: string;
  Escopo?: string;
  Protecoes?: string;
  DependenciasObservacoes?: string;
  Evidencias?: string;
  UltimaAtualizacao?: string;
  Responsavel?: string;
  DataServicoInformada?: string;
  OrigemTeste?: string;
  ProjetoID?: string;
  QuantidadeEtapasConhecidas?: number;
  DataInicioPlanejada?: string | Date;
  DataFimPlanejada?: string | Date;
  DuracaoPlanejadaValor?: number;
  DuracaoPlanejadaUnidade?: string;
  DataInicioReal?: string | Date;
  DataFimReal?: string | Date;
  _isTeste?: boolean;
}

/**
 * Decide o par (duracaoPlanejada, duracaoInvalidaMotivo) a partir dos
 * valores brutos da planilha/fixture. Nunca corrige/arredonda — um par
 * inválido (valor não finito/positivo, unidade desconhecida, dias-úteis
 * fracionário; ver `duracao.ts`) vira só o motivo, nunca uma duração
 * "ajustada".
 */
function normalizarDuracao(
  valorBruto: unknown,
  unidadeBruta: unknown
): { duracaoPlanejada?: DuracaoPlanejada; duracaoInvalidaMotivo?: string } {
  if (valorBruto === undefined || valorBruto === null || valorBruto === '') return {};
  if (unidadeBruta === undefined || unidadeBruta === null || unidadeBruta === '') return {};
  const validacao = validarDuracao({ valor: valorBruto, unidade: unidadeBruta });
  if (!validacao.valida) return { duracaoInvalidaMotivo: validacao.motivo };
  return {
    duracaoPlanejada: {
      valor: Number(valorBruto),
      unidade: unidadeBruta as UnidadeDuracao,
    },
  };
}

export function normalizarOrdem(raw: RawOS): OrdemServico {
  const statusTexto = (raw.Status ?? '').toString();
  const escopo = (raw.Escopo ?? '').toString();
  const qtdEtapas = raw.QuantidadeEtapasConhecidas ?? 0;
  const { duracaoPlanejada, duracaoInvalidaMotivo } = normalizarDuracao(
    raw.DuracaoPlanejadaValor,
    raw.DuracaoPlanejadaUnidade
  );
  return {
    os: (raw.OS ?? '').toString().trim(),
    endereco: (raw.Endereco ?? '').toString(),
    cidade: (raw.Cidade ?? '').toString(),
    statusTexto,
    estado: classificarStatus(statusTexto),
    escopo,
    protecoes: (raw.Protecoes ?? '').toString(),
    dependenciasObservacoes: (raw.DependenciasObservacoes ?? '').toString(),
    evidenciasTexto: (raw.Evidencias ?? '').toString(),
    ultimaAtualizacao: (raw.UltimaAtualizacao ?? '').toString(),
    responsavelInformado: raw.Responsavel || undefined,
    dataServicoInformada: parseDiaLocal(raw.DataServicoInformada),
    origemTeste: raw.OrigemTeste || undefined,
    isTeste: Boolean(raw._isTeste),
    projetoId: raw.ProjetoID || undefined,
    temEtapaAplicavel: temEtapaAplicavel(escopo, qtdEtapas),
    aprovacaoQualidade: { resultado: 'pendente', semEvidencia: true },
    planejamento:
      raw.DataInicioPlanejada || raw.DuracaoPlanejadaValor
        ? {
            dataInicioPlanejada: parseDiaLocal(raw.DataInicioPlanejada),
            dataFimPlanejada: parseDiaLocal(raw.DataFimPlanejada),
            duracaoPlanejada,
            duracaoInvalidaMotivo,
            equipeResponsavel: [],
            versaoPlanejamento: 1,
          }
        : undefined,
    realizado:
      raw.DataInicioReal || raw.DataFimReal
        ? { dataInicioReal: parseDiaLocal(raw.DataInicioReal), dataFimReal: parseDiaLocal(raw.DataFimReal) }
        : undefined,
  };
}
