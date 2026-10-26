import { post, ApiError } from './transport';

export type PlannedAssignment = {
  assignmentId: string; projetoId: string; personId: string; personName: string;
  locationId: string; locationName: string; date: string; startTime?: string;
  endTime?: string; timezone: 'America/New_York'; sourceLabel: string; revision: number;
};
export type ScheduleDataset = { projetoId: string; assignments: PlannedAssignment[]; updatedAt?: string };
type Request = (payload: Record<string, unknown>) => Promise<Record<string, any>>;
const required = ['assignmentId','projetoId','personId','personName','locationId','locationName','date','sourceLabel'] as const;

/** Copy only declared fields. A response is never allowed to widen the selected project. */
export function readScheduleDataset(raw: unknown, project: string): ScheduleDataset {
  const d = raw as any;
  if (!project.trim() || !d || d.projetoId !== project || !Array.isArray(d.assignments)) throw new Error('Resposta de programação inválida.');
  const ids = new Set<string>();
  const assignments = d.assignments.map((a: any): PlannedAssignment => {
    if (!a || required.some(k => typeof a[k] !== 'string' || !a[k].trim()) || a.projetoId !== project || ids.has(a.assignmentId) || a.timezone !== 'America/New_York' || !Number.isInteger(a.revision) || a.revision < 1) throw new Error('Resposta de programação inválida.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || new Date(a.date+'T12:00:00Z').toISOString().slice(0,10) !== a.date) throw new Error('Data inválida.');
    const hasStart = a.startTime !== undefined && a.startTime !== '';
    const hasEnd = a.endTime !== undefined && a.endTime !== '';
    if ((hasEnd&&!hasStart) || (hasStart&&(typeof a.startTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.startTime))) || (hasEnd&&(typeof a.endTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.endTime)||a.endTime<=a.startTime))) throw new Error('Horário inválido.');
    ids.add(a.assignmentId);
    return {assignmentId:a.assignmentId,projetoId:a.projetoId,personId:a.personId,personName:a.personName,locationId:a.locationId,locationName:a.locationName,date:a.date,...(hasStart?{startTime:a.startTime}:{}),...(hasEnd?{endTime:a.endTime}:{}),timezone:'America/New_York',sourceLabel:a.sourceLabel,revision:a.revision};
  });
  return {projetoId:project,assignments,...(typeof d.updatedAt==='string'?{updatedAt:d.updatedAt}:{})};
}

export function createScheduleApi(request: Request = post) {
 return {
  async list(token: string, projetoId: string) {
    const result = await request({action:'scheduleList',token,projetoId});
    return readScheduleDataset(result.dataset,projetoId);
  },
  async save(token: string, projetoId: string, assignment: PlannedAssignment, requestId: string, expectedRevision: number) {
    if(assignment.projetoId!==projetoId) throw new ApiError('Projeto inválido.','FORBIDDEN');
    // One explicit attempt; the caller keeps requestId on an uncertain result.
    const result = await request({action:'scheduleSave',token,projetoId,assignment,requestId,expectedRevision});
    const receipt = readScheduleDataset({projetoId,assignments:[result.assignment]},projetoId).assignments[0];
    if(receipt.assignmentId!==assignment.assignmentId || receipt.revision!==expectedRevision+1) throw new ApiError('Confirmação de gravação inválida.','UNCONFIRMED');
    // The panel confirms persistence only after a separate authoritative read.
    const dataset = await this.list(token,projetoId);
    const saved = dataset.assignments.find(a=>a.assignmentId===assignment.assignmentId);
    if(!saved || saved.revision < receipt.revision) throw new ApiError('Gravação ainda não confirmada pela releitura.','UNCONFIRMED');
    return dataset;
  }
 };
}
