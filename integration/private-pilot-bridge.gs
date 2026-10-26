// Private Google-hosted test surface. Existing application authentication stays mandatory.
function privatePilotRequest(p) {
  var allowed=['listOsProjects','listOsMembers','listOsOperacional','detailOsOperacional','createOsOperacional','assignOsOperacional','advanceOsOperacional','reopenOsOperacional','logout'];
  try {
    if(!p || typeof p!=='object' || JSON.stringify(p).length>8192) throw new Error('Pedido invalido.');
    if(p.action==='login') {
      if(p.username!=='boss') throw new Error('Piloto restrito a boss.');
    } else {
      if(allowed.indexOf(p.action)<0) throw new Error('Acao nao permitida no piloto.');
      var actor=osSession_(p.token);
      if(actor.Usuario!=='boss') throw new Error('Piloto restrito a boss.');
      if(p.action!=='listOsProjects' && p.action!=='logout' && p.projetoId!=='PILOTO_FICTICIO_RSF_20261021') throw new Error('Projeto fora do piloto.');
    }
    return JSON.parse(doPost({parameter:{payload:JSON.stringify(p)}}).getContent());
  } catch (_) { return {ok:false,code:'PILOT_DENIED',erro:'Pedido negado pelo piloto privado.'}; }
}
