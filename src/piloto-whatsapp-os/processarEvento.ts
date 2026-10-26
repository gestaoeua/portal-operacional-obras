// Lógica pura de conversão evento-simulado -> rascunho de OS. Sem rede, sem
// Apps Script, sem credenciais — só transformação de dados em memória, para
// poder ser testada localmente com fixtures fictícias. Ver aviso de contrato
// hipotético em `tipos.ts`.
import type { EventoGrupoSimulado, RascunhoOS } from './tipos';

/**
 * Converte um evento simulado num rascunho de OS. Nunca lança por falta de
 * autor — a ausência de autor é um estado de dados válido (triagem manual),
 * não um erro de parsing. Isso é deliberado porque a lacuna nº2 do parecer
 * (identidade do autor em grupo) não está resolvida: o parser precisa
 * continuar funcionando mesmo que o provedor real não traga esse campo.
 */
export function processarEvento(evento: EventoGrupoSimulado): RascunhoOS {
  return {
    idMensagem: evento.idMensagem,
    idGrupo: evento.idGrupo,
    nomeGrupoFicticio: evento.nomeGrupoFicticio,
    autor: evento.autor,
    tipo: evento.tipo,
    texto: evento.texto,
    midiaRef: evento.midia?.refExterna,
    timestampDeclarado: evento.timestampDeclarado,
    status: evento.autor ? 'pendente_triagem' : 'sem_autor_identificado',
  };
}
