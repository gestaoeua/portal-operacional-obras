import { APPS_SCRIPT_URL } from './config';
import type { Status, UserSession, WorkAction, WorkVisit } from './types';

const DEMO_KEY = 'mapa-progresso-demo-v1';
export const DEMO_MODE = false;

function readVisits(): WorkVisit[] {
  return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]');
}

function writeVisits(visits: WorkVisit[]) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(visits));
}

async function post(payload: Record<string, unknown>) {
  const body = new URLSearchParams({ payload: JSON.stringify(payload) });
  const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body });
  const data = await response.json();
  if (!data.ok) throw new Error(data.erro || 'Não foi possível concluir a operação.');
  return data;
}

export async function login(username: string, password: string): Promise<UserSession> {
  if (!DEMO_MODE) return (await post({ action: 'login', username, password })).session;
  throw new Error('O modo de demonstração está desativado.');
}

export async function getVisits(session?: UserSession): Promise<WorkVisit[]> {
  if (!DEMO_MODE) return (await post({ action: 'listVisits', token: session?.token })).visits;
  return readVisits();
}

export async function enterRoom(session: UserSession, roomMark: string, roomName: string): Promise<WorkVisit> {
  if (!DEMO_MODE) return (await post({ action: 'enter', token: session.token, roomMark })).visit;
  const visit: WorkVisit = { id: crypto.randomUUID(), userId: session.userId, userName: session.name, roomMark, roomName, startedAt: new Date().toISOString() };
  const visits = readVisits();
  visits.push(visit);
  writeVisits(visits);
  return visit;
}

export async function exitRoom(session: UserSession, visitId: string, action: WorkAction, finalStatus: Status): Promise<WorkVisit> {
  if (!DEMO_MODE) return (await post({ action: 'exit', token: session.token, visitId, workAction: action, finalStatus })).visit;
  const visits = readVisits();
  const visit = visits.find((item) => item.id === visitId);
  if (!visit) throw new Error('Atendimento não encontrado.');
  visit.endedAt = new Date().toISOString();
  visit.action = action;
  visit.finalStatus = finalStatus;
  writeVisits(visits);
  return visit;
}
