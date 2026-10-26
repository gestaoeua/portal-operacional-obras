import { describe,it,expect,vi } from 'vitest';
import {createScheduleApi,readScheduleDataset,type PlannedAssignment} from './scheduleApi';
const a:PlannedAssignment={assignmentId:'a',projetoId:'p',personId:'person-ficticia',personName:'Pessoa fictícia',locationId:'local-ficticio',locationName:'Local fictício',date:'2026-10-22',timezone:'America/New_York',sourceLabel:'Teste fictício',revision:1};
describe('schedule transport boundary',()=>{
 it('rejects foreign project, invalid calendar dates, duplicates and partial time',()=>{
  for(const assignments of [[{...a,projetoId:'other'}],[{...a,date:'2026-02-30'}],[a,a],[{...a,endTime:'09:00'}]]) expect(()=>readScheduleDataset({projetoId:'p',assignments},'p')).toThrow();
 });
 it('copies declared fields only and preserves unknown time',()=>{
  const original={...a,secret:'not exposed'};
  const got=readScheduleDataset({projetoId:'p',assignments:[original]},'p');
  expect(got.assignments[0]).toEqual(a);
  got.assignments[0].personName='changed'; expect(original.personName).toBe(a.personName);
 });
 it('preserves user supplied start without inventing an end',()=>{
  const got=readScheduleDataset({projetoId:'p',assignments:[{...a,startTime:'08:00',endTime:''}]},'p').assignments[0];
  expect(got.startTime).toBe('08:00');expect(got.endTime).toBeUndefined();
 });
 it('saves once, then verifies independent read',async()=>{
  const request=vi.fn().mockResolvedValueOnce({ok:true,assignment:a}).mockResolvedValueOnce({ok:true,dataset:{projetoId:'p',assignments:[a]}});
  const api=createScheduleApi(request); expect((await api.save('synthetic','p',a,'request-1',0)).assignments).toEqual([a]);
  expect(request.mock.calls.map(c=>c[0].action)).toEqual(['scheduleSave','scheduleList']);
 });
 it('does not retry uncertain writes automatically',async()=>{
  const request=vi.fn().mockRejectedValue(Error('timeout'));
  await expect(createScheduleApi(request).save('synthetic','p',a,'same-request',0)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
 });
 it('does not claim persistence when authoritative read is empty',async()=>{
  const request=vi.fn().mockResolvedValueOnce({ok:true,assignment:a}).mockResolvedValueOnce({ok:true,dataset:{projetoId:'p',assignments:[]}});
  await expect(createScheduleApi(request).save('synthetic','p',a,'r',0)).rejects.toMatchObject({code:'UNCONFIRMED'});
 });
});
