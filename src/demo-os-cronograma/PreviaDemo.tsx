// Prévia pública, isolada — SOMENTE dados de demonstração, NUNCA toca
// qualquer backend real (nenhum `fetch`, nenhuma URL real em todo este
// diretório — ver `normalizar.ts`). Publicada em `/demo-os-cronograma/`,
// aditiva ao portal existente: o app real (`src/App.tsx`, `src/App.css`,
// `apps-script/Code.gs`) não ganha nenhuma linha nova por causa desta
// publicação.
//
// Extraído de uma versão de desenvolvimento interna (onde este componente
// vivia dentro de `src/App.tsx`, com outro nome) especificamente para esta
// publicação — mesma lógica, sem nenhuma mudança de comportamento, só: (1)
// movido para seu próprio arquivo, para `src/App.tsx` do app real nunca ser
// tocado; (2) renomeado e com os textos visíveis trocados por nomes
// genéricos — nenhum nome de pessoa real aparece aqui (ver `fixtures.ts`,
// sanitizado do mesmo jeito; ver `__tests__/sanitizacao.test.ts`, que
// verifica isso programaticamente).
//
// Mesma proteção de sequência/contexto do caminho real: trocar o "Ver como"
// limpa a tela na hora e descarta qualquer resposta atrasada do usuário de
// demonstração anterior (ver `fontes.ts#ControladorDeSequencia` — aqui
// reforçada por um `contextoAtualRef`, que é a checagem que de fato pega
// uma troca de contexto quando cada contexto só faz UMA requisição; a
// sequência sozinha não bastaria).
import { useEffect, useRef, useState } from 'react';
import { OsPanel } from './OsPanel';
import { normalizarOrdem } from './normalizar';
import type { LeituraFonte, OrdemServico } from './types';
import { DEMO_OS_FIXTURES, DEMO_PROJETOS, DEMO_USUARIOS } from './fixtures';
import { AutorizacaoProviderDemo, filtrarOrdensPorAutorizacao, resolverProjetosAutorizados } from './authorization';
import { ControladorDeSequencia, chaveContexto } from './fontes';
import type { ContextoConsulta } from './fontes';

type UsuarioDemo = 'gestor-demo' | 'gestor-sem-config-demo';

export function PreviaDemo() {
  const [usuarioDemo, setUsuarioDemo] = useState<UsuarioDemo>('gestor-demo');
  const [leitura, setLeitura] = useState<LeituraFonte<OrdemServico[]>>({ estado: 'carregando', dados: [] });
  const controlador = useRef(new ControladorDeSequencia()).current;
  const contextoAtualRef = useRef<string>('');

  useEffect(() => {
    setLeitura({ estado: 'carregando', dados: [] });
    const contexto: ContextoConsulta = { usuario: usuarioDemo, projetoId: 'demo', recurso: 'os' };
    const chave = chaveContexto(contexto);
    contextoAtualRef.current = chave;
    const sequencia = controlador.novaRequisicao();
    const podeAplicarAgora = () => contextoAtualRef.current === chave && controlador.podeAplicar(contexto, sequencia);
    const provider = new AutorizacaoProviderDemo(DEMO_PROJETOS, DEMO_USUARIOS);
    resolverProjetosAutorizados(usuarioDemo, provider).then((auth) => {
      if (!podeAplicarAgora()) return;
      if (!auth.ok) {
        setLeitura({ estado: 'indisponivel', dados: [], motivo: `${auth.bloqueio}: ${auth.motivoBloqueio}` });
        return;
      }
      // Reaproveita o MESMO normalizador do caminho real (normalizar.ts) —
      // nenhuma lógica de status/data duplicada aqui — e o MESMO filtro de
      // autorização por projeto (authorization.ts#filtrarOrdensPorAutorizacao),
      // nunca uma reimplementação paralela.
      const normalizadas = DEMO_OS_FIXTURES.map(normalizarOrdem);
      const { autorizadas, semProjetoAtribuido } = filtrarOrdensPorAutorizacao(normalizadas, auth.projetosAutorizados);
      setLeitura({ estado: autorizadas.length ? 'disponivel' : 'vazio', dados: autorizadas, semProjetoAtribuido });
    });
    return () => {
      controlador.esquecerContexto(contexto);
    };
  }, [usuarioDemo, controlador]);

  return (
    <main>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', background: '#14243b', color: '#fff' }}>
        <b>Prévia pública — OS/Cronograma</b>
        <span>DEMO</span>
      </header>
      <aside style={{ background: '#fff2bf', textAlign: 'center', padding: 7, fontSize: 11, fontWeight: 'bold' }}>
        PRÉVIA — dados inteiramente fictícios, nenhum dado real, nenhuma integração ativa
      </aside>
      <div style={{ maxWidth: 1100, margin: 'auto', padding: '16px 18px', boxSizing: 'border-box' }}>
        <label style={{ fontSize: 12, display: 'block' }}>
          Ver como:
          <select
            value={usuarioDemo}
            onChange={(e) => setUsuarioDemo(e.target.value as UsuarioDemo)}
            style={{ display: 'block', width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginTop: 4 }}
          >
            <option value="gestor-demo">Gestor Demo (autorizado só para o projeto-exemplo A)</option>
            <option value="gestor-sem-config-demo">Gestor sem configuração (sem vínculo de autorização — deve bloquear)</option>
          </select>
        </label>
        <OsPanel leitura={leitura} demo chaveContexto={usuarioDemo} />
      </div>
    </main>
  );
}
