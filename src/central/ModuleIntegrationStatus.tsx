const sources = [
  ['Propriedades e unidades', 'Não integrado', 'O cadastro de locais de campo não contém vínculos propertyId/unitId. Projeto e sala não serão convertidos em imóveis automaticamente.'],
  ['Equipes', 'Não integrado', 'Contas ativas e responsáveis de OS são pessoas autorizadas; falta cadastro de equipes e vínculos.'],
  ['Serviços', 'Não integrado', 'As atividades de campo não substituem um catálogo de serviços versionado.'],
  ['Calendário', 'Não integrado', 'A etapa Programada não informa data ou duração. As OS sem agendamento permanecem sem data.'],
  ['Financeiro e horas externas', 'Fonte separada', 'Gestão à Vista usa outra fonte. Importações JSON não representam integração QuickBooks Time.'],
  ['Ferramentas', 'Não integrado', 'Categoria de custo não representa estoque, retirada, devolução ou custódia.'],
];
export default function ModuleIntegrationStatus() {
  return <section className="panel"><h2>Fontes e integrações</h2>
    <p>Esta consulta não confirma atualização operacional. Horário de carregamento e data registrada na fonte são informações diferentes.</p>
    <table><caption>Disponibilidade dos cadastros complementares</caption><thead><tr><th>Módulo</th><th>Estado</th><th>Limite atual</th></tr></thead>
      <tbody>{sources.map(([name,state,detail])=><tr key={name}><th scope="row">{name}</th><td>{state}</td><td>{detail}</td></tr>)}</tbody></table>
  </section>;
}
