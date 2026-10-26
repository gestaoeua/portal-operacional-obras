// Fixtures INTEIRAMENTE FICTÍCIAS para o piloto local. Nenhum grupo, nome,
// número ou texto aqui corresponde a um grupo ou pessoa real — tudo
// inventado só para exercitar o parser/aplicador. NUNCA atribua este
// formato ao contrato real do W-API (ver aviso em `tipos.ts`).
import type { EventoGrupoSimulado } from './tipos';

export const EVENTOS_FICTICIOS: EventoGrupoSimulado[] = [
  {
    idMensagem: 'msg-ficticia-001',
    idGrupo: 'grupo-obra-exemplo-A',
    nomeGrupoFicticio: 'Obra Exemplo A — Equipe',
    autor: 'pintor-exemplo-1',
    tipo: 'texto',
    texto: 'Terminei a pintura do quarto 2, falta o acabamento da porta.',
    timestampDeclarado: '2026-10-10T14:00:00Z',
    autenticidadeVerificada: true,
  },
  {
    idMensagem: 'msg-ficticia-002',
    idGrupo: 'grupo-obra-exemplo-A',
    nomeGrupoFicticio: 'Obra Exemplo A — Equipe',
    autor: 'pintor-exemplo-1',
    tipo: 'foto',
    midia: { tipo: 'foto', refExterna: 'fixture-foto-ficticia-quarto2.jpg' },
    timestampDeclarado: '2026-10-10T14:01:00Z',
    autenticidadeVerificada: true,
  },
  {
    // Sem autor — simula um payload onde a identidade do remetente em
    // grupo não veio preenchida (lacuna nº2 do parecer).
    idMensagem: 'msg-ficticia-003',
    idGrupo: 'grupo-obra-exemplo-B',
    nomeGrupoFicticio: 'Obra Exemplo B — Equipe',
    tipo: 'audio',
    midia: { tipo: 'audio', refExterna: 'fixture-audio-ficticio-recado.ogg' },
    timestampDeclarado: '2026-10-10T15:30:00Z',
    autenticidadeVerificada: false,
  },
  {
    // Duplicata deliberada do primeiro evento, simulando replay/reenvio
    // (lacuna nº4) — mesmo idMensagem, para provar deduplicação.
    idMensagem: 'msg-ficticia-001',
    idGrupo: 'grupo-obra-exemplo-A',
    nomeGrupoFicticio: 'Obra Exemplo A — Equipe',
    autor: 'pintor-exemplo-1',
    tipo: 'texto',
    texto: 'Terminei a pintura do quarto 2, falta o acabamento da porta.',
    timestampDeclarado: '2026-10-10T14:00:00Z',
    autenticidadeVerificada: true,
  },
];
