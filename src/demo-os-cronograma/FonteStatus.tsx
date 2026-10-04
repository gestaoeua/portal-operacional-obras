// Indicador de estado de uma fonte — reaproveitável por qualquer painel
// (OS, Cronograma, e os futuros painéis de QuickBooks/WhatsApp, quando
// existirem). Nunca deixa uma fonte lenta/indisponível travar a renderização
// de outra — cada chamador decide independentemente quando mostrar isto.
import type { EstadoFonte } from './types';

const ROTULOS: Record<EstadoFonte, string> = {
  carregando: 'Carregando…',
  disponivel: 'Disponível',
  vazio: 'Nenhum registro ainda',
  zero_confirmado: '0 (confirmado)',
  indisponivel: 'Indisponível',
  parcial: 'Parcial — parte dos dados não veio',
  desatualizado: 'Desatualizado',
};

export function FonteStatus({
  estado,
  motivo,
  ultimaLeituraValidaEm,
}: {
  estado: EstadoFonte;
  motivo?: string;
  ultimaLeituraValidaEm?: string;
}) {
  if (estado === 'disponivel') return null; // sem fricção quando está tudo bem
  return (
    <div className={`fonte-status fonte-status-${estado}`}>
      <b>{ROTULOS[estado]}</b>
      {motivo && <span> — {motivo}</span>}
      {ultimaLeituraValidaEm && estado === 'desatualizado' && (
        <span> (dado de {ultimaLeituraValidaEm}, pode estar desatualizado)</span>
      )}
    </div>
  );
}
