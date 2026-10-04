// Fixtures de demonstração — SOMENTE para esta prévia pública. Nunca
// importado por nenhum código de rede/produção (este diretório nem tem um
// cliente de rede — ver normalizar.ts). Rotulado em toda tela que as usar
// ("DADOS DE DEMONSTRAÇÃO — não é a produção real") e nunca somado a uma
// contagem de produção real, como exigido.
//
// SANITIZAÇÃO (auditoria de publicação desta demo): os endereços, cidades,
// nomes de usuário e nomes de projeto-piloto abaixo foram substituídos por
// ficção INEQUÍVOCA — nenhuma rua/cidade real de NH, nenhum nome de pessoa
// real, nenhum codinome real de projeto. Ver `__tests__/sanitizacao.test.ts`,
// que verifica isso programaticamente por LISTA DE PERMISSÃO (allow-list):
// cada valor de Endereco/Cidade/Responsavel/OrigemTeste/usuário abaixo tem
// que bater exatamente com um dos valores fictícios aprovados — nunca por
// comparação (nem hash) contra o dado real, que nunca é representado em
// nenhuma forma, nem mesmo derivada, em nenhum arquivo publicado.
import type { RawOS } from './normalizar';
import type { ProjetoRegistro, UsuarioAutorizacao } from './authorization';

export const DEMO_OS_FIXTURES: RawOS[] = [
  {
    OS: 'OS-101',
    Endereco: '100 Example St',
    Cidade: 'Sample City, NH',
    Status: 'A executar',
    Escopo: 'Pintura de trim e portas do 2º andar',
    Protecoes: 'Não remover a fita do piso de madeira',
    DependenciasObservacoes: 'Aguardando liberação do eletricista',
    Evidencias: '',
    UltimaAtualizacao: '2026-09-28',
    ProjetoID: 'proj-A',
    QuantidadeEtapasConhecidas: 2,
    DataInicioPlanejada: '2026-10-06',
    DuracaoPlanejadaValor: 3,
    DuracaoPlanejadaUnidade: 'dias-corridos',
    _isTeste: false,
  },
  {
    OS: 'OS-102',
    Endereco: '100 Example St',
    Cidade: 'Sample City, NH',
    Status: 'Finalizada',
    Escopo: 'Pintura das paredes do porão',
    Protecoes: '',
    DependenciasObservacoes: '',
    Evidencias: 'antes_porao.jpg; depois_porao.jpg',
    UltimaAtualizacao: '2026-09-20',
    ProjetoID: 'proj-A',
    QuantidadeEtapasConhecidas: 1,
    DataInicioReal: '2026-09-15',
    DataFimReal: '2026-09-18',
    _isTeste: false,
  },
  {
    // OS legada, com um texto de status fora da tabela conhecida —
    // nunca deve virar NAO_INICIADA nem EM_ANDAMENTO por suposição.
    OS: 'OS-103',
    Endereco: '200 Placeholder Ave',
    Cidade: 'Demo City, NH',
    Status: 'Aguardando material',
    Escopo: 'Pintura externa',
    Protecoes: '',
    DependenciasObservacoes: '',
    Evidencias: '',
    UltimaAtualizacao: '2026-09-10',
    ProjetoID: 'proj-A',
    QuantidadeEtapasConhecidas: 1,
    _isTeste: false,
  },
  {
    // Escopo vazio e zero etapas conhecidas — nunca pode contar como concluída.
    OS: 'OS-104',
    Endereco: '200 Placeholder Ave',
    Cidade: 'Demo City, NH',
    Status: 'A executar',
    Escopo: '',
    Protecoes: '',
    DependenciasObservacoes: '',
    Evidencias: '',
    UltimaAtualizacao: '2026-09-09',
    ProjetoID: 'proj-A',
    QuantidadeEtapasConhecidas: 0,
    _isTeste: false,
  },
  {
    // Só horas-pessoa, sem data — nunca vira barra de duração.
    OS: 'OS-105',
    Endereco: '300 Fictional Ln',
    Cidade: 'Test City, NH',
    Status: 'A executar',
    Escopo: 'Retoque de touch-up em três quartos',
    Protecoes: '',
    DependenciasObservacoes: '',
    Evidencias: '',
    UltimaAtualizacao: '2026-09-25',
    ProjetoID: 'proj-B',
    QuantidadeEtapasConhecidas: 1,
    DuracaoPlanejadaValor: 6,
    DuracaoPlanejadaUnidade: 'horas-pessoa',
    _isTeste: false,
  },
  {
    // OS em outro projeto — usada para testar o bloqueio de acesso cruzado.
    OS: 'OS-201',
    Endereco: '400 Anyroad Dr',
    Cidade: 'Model City, NH',
    Status: 'A executar',
    Escopo: 'Pintura da fachada',
    Protecoes: '',
    DependenciasObservacoes: '',
    Evidencias: '',
    UltimaAtualizacao: '2026-09-29',
    ProjetoID: 'proj-B',
    QuantidadeEtapasConhecidas: 1,
    DataInicioPlanejada: '2026-10-10',
    DuracaoPlanejadaValor: 5,
    DuracaoPlanejadaUnidade: 'dias-uteis',
    _isTeste: false,
  },
  {
    // TEST-001 — exatamente como informado: só data de serviço isolada,
    // conclusão de teste, sem duração real nem aprovação. Vem da aba
    // "OS - Testes" -> _isTeste é setado pela origem, não por um campo.
    OS: 'TEST-001',
    Endereco: 'Endereço de teste',
    Cidade: 'Cidade de teste',
    Status: 'Teste: concluída (informado)',
    Escopo: 'Cenário de teste do piloto',
    Protecoes: '',
    DependenciasObservacoes: '',
    Evidencias: '',
    UltimaAtualizacao: '2026-10-02',
    Responsavel: 'Perfil de teste',
    DataServicoInformada: '2026-10-02',
    OrigemTeste: 'piloto-exemplo',
    ProjetoID: 'proj-A',
    QuantidadeEtapasConhecidas: 1,
    _isTeste: true,
  },
  {
    // Mesma aba de teste, mas com OrigemTeste VAZIO — ainda assim deve ser
    // tratada como teste, porque o discriminador é a aba, não este campo.
    OS: 'TEST-002',
    Endereco: 'Endereço de teste 2',
    Cidade: 'Cidade de teste',
    Status: 'A executar',
    Escopo: 'Segundo cenário de teste',
    Protecoes: '',
    DependenciasObservacoes: '',
    Evidencias: '',
    UltimaAtualizacao: '2026-10-02',
    OrigemTeste: '',
    ProjetoID: 'proj-A',
    QuantidadeEtapasConhecidas: 1,
    _isTeste: true,
  },
];

export const DEMO_PROJETOS: ProjetoRegistro[] = [
  { projetoId: 'proj-A', ativo: true },
  { projetoId: 'proj-B', ativo: true },
];

export const DEMO_USUARIOS: UsuarioAutorizacao[] = [
  // gestor-demo só pode ver proj-A — usado para provar o bloqueio de acesso cruzado.
  { usuario: 'gestor-demo', perfil: 'gestor', projetosAutorizados: ['proj-A'] },
  { usuario: 'gestor-sem-config-demo', perfil: 'gestor' }, // sem a coluna -> deve bloquear
];
