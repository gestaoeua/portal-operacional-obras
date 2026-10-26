/**
 * Equipes e serviços por projeto — lógica pura, sem fetch e sem componente.
 *
 * Fonte de verdade: um dataset explícito fornecido por quem integra esta
 * fatia (nunca buscado por este módulo). Nunca deriva equipes da aba
 * `Usuarios` nem trata `WorkAction` como catálogo de serviços — os dois
 * conceitos aqui são independentes de qualquer estrutura já existente no
 * app. Falha fechado: um conjunto malformado, misturado entre projetos,
 * com IDs duplicados, membro repetido na mesma equipe ou versão de
 * serviço inválida é rejeitado por inteiro, com mensagem genérica — nunca
 * revela o ID de uma linha de outro projeto.
 */

export interface MemberEntry {
  memberId: string;
  name: string;
}

export interface TeamEntry {
  teamId: string;
  projetoId: string;
  name: string;
  members: MemberEntry[];
}

/** Múltiplas versões do MESMO serviço são esperadas: a identidade de um serviço é a chave composta (serviceId, version), nunca serviceId isolado. */
export interface ServiceEntry {
  serviceId: string;
  projetoId: string;
  version: number;
  name: string;
  description: string;
}

/** Dataset explícito esperado como entrada — nunca construído a partir de `Usuarios` ou `WorkAction`. */
export interface TeamsServicesDataset {
  teams: TeamEntry[];
  services: ServiceEntry[];
}

export type ConjuntoInvalido =
  | { motivo: 'formato'; detalhe: string }
  | { motivo: 'projeto_misto'; detalhe: string }
  | { motivo: 'equipe_duplicada'; detalhe: string }
  | { motivo: 'membro_duplicado_na_equipe'; detalhe: string }
  | { motivo: 'versao_invalida'; detalhe: string }
  | { motivo: 'servico_versao_duplicada'; detalhe: string };

export type ValidacaoDataset =
  | { ok: true; dataset: TeamsServicesDataset }
  | { ok: false; erro: ConjuntoInvalido };

function isNonEmptyString(value: unknown): value is string {
  // Whitespace-only ("   ") não é um ID válido: `.length > 0` sozinho
  // aceitaria isso, então a checagem real é sobre o texto aparado.
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Valida o dataset bruto ANTES de qualquer renderização. Rejeições
 * exigidas, todas fail-closed e com mensagem genérica (nunca expõem o ID
 * de uma linha de outro projeto):
 *   - formato inesperado (`formato`);
 *   - qualquer equipe ou serviço de outro projeto (`projeto_misto`);
 *   - TeamId repetido (`equipe_duplicada`);
 *   - memberId repetido DENTRO da mesma equipe (`membro_duplicado_na_equipe`);
 *   - version que não é inteiro positivo (`versao_invalida`);
 *   - (serviceId, version) repetido — versões diferentes do mesmo
 *     serviceId são aceitas; é a combinação que precisa ser única
 *     (`servico_versao_duplicada`).
 */
export function validarConjunto(value: unknown, projetoId: string): ValidacaoDataset {
  if (typeof projetoId !== 'string' || !projetoId.trim()) {
    return { ok: false, erro: { motivo: 'formato', detalhe: 'Projeto inválido para equipes e serviços.' } };
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as Record<string, unknown>).teams) ||
    !Array.isArray((value as Record<string, unknown>).services)
  ) {
    return {
      ok: false,
      erro: { motivo: 'formato', detalhe: 'Conjunto de equipes e serviços não tem o formato esperado.' },
    };
  }
  const rawTeams = (value as { teams: unknown[] }).teams;
  const rawServices = (value as { services: unknown[] }).services;

  const teams: TeamEntry[] = [];
  const teamIds = new Set<string>();
  for (const item of rawTeams) {
    if (
      !item ||
      typeof item !== 'object' ||
      !isNonEmptyString((item as Record<string, unknown>).teamId) ||
      typeof (item as Record<string, unknown>).projetoId !== 'string' ||
      typeof (item as Record<string, unknown>).name !== 'string' ||
      !Array.isArray((item as Record<string, unknown>).members)
    ) {
      return { ok: false, erro: { motivo: 'formato', detalhe: 'Uma equipe tem formato inesperado.' } };
    }
    const rawTeam = item as { teamId: string; projetoId: string; name: string; members: unknown[] };
    if (rawTeam.projetoId !== projetoId) {
      return {
        ok: false,
        erro: { motivo: 'projeto_misto', detalhe: 'O conjunto recebido contém uma equipe de outro projeto.' },
      };
    }
    if (teamIds.has(rawTeam.teamId)) {
      return {
        ok: false,
        erro: { motivo: 'equipe_duplicada', detalhe: 'Uma equipe aparece mais de uma vez no conjunto.' },
      };
    }
    teamIds.add(rawTeam.teamId);

    const members: MemberEntry[] = [];
    const memberIds = new Set<string>();
    for (const m of rawTeam.members) {
      if (
        !m ||
        typeof m !== 'object' ||
        !isNonEmptyString((m as Record<string, unknown>).memberId) ||
        typeof (m as Record<string, unknown>).name !== 'string'
      ) {
        return { ok: false, erro: { motivo: 'formato', detalhe: 'Um membro de equipe tem formato inesperado.' } };
      }
      const member = m as MemberEntry;
      if (memberIds.has(member.memberId)) {
        return {
          ok: false,
          erro: { motivo: 'membro_duplicado_na_equipe', detalhe: 'Uma equipe tem um membro repetido.' },
        };
      }
      memberIds.add(member.memberId);
      // Cópia defensiva: nunca empurra o objeto bruto `member` (que pode
      // trazer campos extras do que o integrador enviou) para o dataset
      // validado — só os campos declarados de MemberEntry são copiados.
      // Isso garante que mutar o resultado depois nunca altera a entrada
      // original, e que um campo extra nunca atravessa a validação.
      // memberId é copiado exatamente como recebido (nunca renormalizado
      // após a checagem acima); name só é aparado para o fallback visual.
      members.push({ memberId: member.memberId, name: member.name.trim() });
    }
    // Cópia defensiva: name é aparado só para habilitar o fallback
    // visual já existente na tela (nunca vira exigência — string vazia
    // continua um dataset válido). teamId é mantido exatamente como
    // recebido, nunca renormalizado após a checagem de duplicidade.
    teams.push({ teamId: rawTeam.teamId, projetoId: rawTeam.projetoId, name: rawTeam.name.trim(), members });
  }

  const services: ServiceEntry[] = [];
  const servicesVistos = new Set<string>();
  for (const item of rawServices) {
    if (
      !item ||
      typeof item !== 'object' ||
      !isNonEmptyString((item as Record<string, unknown>).serviceId) ||
      typeof (item as Record<string, unknown>).projetoId !== 'string' ||
      typeof (item as Record<string, unknown>).version !== 'number' ||
      typeof (item as Record<string, unknown>).name !== 'string' ||
      typeof (item as Record<string, unknown>).description !== 'string'
    ) {
      return { ok: false, erro: { motivo: 'formato', detalhe: 'Um serviço tem formato inesperado.' } };
    }
    const rawService = item as ServiceEntry;
    // Number.isSafeInteger (não só Number.isInteger): mesmo padrão já usado
    // no backend (requireRevisaoEsperada_ em apps-script/Code.gs) — rejeita
    // também inteiros fora da faixa segura de precisão do JS.
    if (!Number.isSafeInteger(rawService.version) || rawService.version <= 0) {
      return {
        ok: false,
        erro: { motivo: 'versao_invalida', detalhe: 'Um serviço tem uma versão que não é um número inteiro positivo.' },
      };
    }
    if (rawService.projetoId !== projetoId) {
      return {
        ok: false,
        erro: { motivo: 'projeto_misto', detalhe: 'O conjunto recebido contém um serviço de outro projeto.' },
      };
    }
    // Chave composta de propósito: versões diferentes do MESMO serviceId
    // são entradas distintas e válidas — só a combinação precisa ser única.
    const chave = `${rawService.serviceId}::${rawService.version}`;
    if (servicesVistos.has(chave)) {
      return {
        ok: false,
        erro: { motivo: 'servico_versao_duplicada', detalhe: 'Um serviço tem a mesma versão repetida no conjunto.' },
      };
    }
    servicesVistos.add(chave);
    // Mesma cópia defensiva do lado de equipes: nunca empurra `rawService`
    // (o objeto bruto, que pode ter campos extras) para o dataset
    // validado — só os campos declarados de ServiceEntry são copiados.
    // serviceId, projetoId e version ficam exatamente como recebidos;
    // name/description só são aparados para o fallback visual, nunca
    // viram exigência (string vazia continua um serviço válido).
    services.push({
      serviceId: rawService.serviceId,
      projetoId: rawService.projetoId,
      version: rawService.version,
      name: rawService.name.trim(),
      description: rawService.description.trim(),
    });
  }

  return { ok: true, dataset: { teams, services } };
}
