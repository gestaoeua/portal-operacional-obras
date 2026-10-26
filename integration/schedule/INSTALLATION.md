STATUS: PREPARED ONLY. No live sheet, route, version or deployment changed.

Proposed additive storage: Programacao_Eventos
Exact ordered headers:
RequestId,ProjetoId,AssignmentId,Revision,Actor,CreatedAt,CommandJson,AssignmentJson

Approval required before creating this new live sheet. Existing OS_Acessos grants
remain the only project access source. No new grants, OAuth or credentials.
Session: osSession_ from the compatible pilot. Writes: gestor or diretor role;
boss is a username and must still have its existing active role and project grant.
People/sites are explicit scheduling references, not inferred from login accounts.

After approval and review: include Schedule.gs in same private Apps Script pilot;
dispatch ONLY scheduleList and scheduleSave to scheduleRequest_(parsedPayload)
from existing HTTP/private UI routers. Preserve all prior routes/auth functions.
No new deployment: version the existing private-only pilot. Preserve v3 rollback.
No changes to original production deployment. Do not append this to foundation auth.

List request: {action:'scheduleList',token,projetoId}
Response: {ok:true,dataset:{projetoId,assignments,updatedAt},history}
Save request: {action:'scheduleSave',token,projetoId,requestId:UUID,
 expectedRevision:0 for new or current revision,assignment:{assignmentId,projetoId,
 personId,personName,locationId,locationName,date:'YYYY-MM-DD',startTime:'HH:mm' or '',
 endTime:'HH:mm' or '',timezone:'America/New_York',sourceLabel}}
Response: {ok:true,assignment,replayed,conflicts:[assignmentIds]}
The assignment revision is server-owned. Missing times stay empty. Start time
without end time is valid and requires review: no duration or end is invented.
End without start is invalid. Only complete intervals produce confirmed overlap
results; an empty conflicts list does NOT guarantee no overlap for incomplete
times. Overnight intervals must be split explicitly. DST ambiguous
or nonexistent wall times are rejected; no offset is invented. Conflicts are
signaled within the authorized project, never exposing other projects.
Assignment identity is the composite (projetoId, assignmentId). A matching ID in
another project is unrelated and is neither disclosed nor used for authorization.
WRITE_UNCONFIRMED: retry EXACT same requestId and payload, not a new command.
Do independent list after save. Never interpret source load time as source freshness.

Local tests: node --test tests/schedule-backend.test.cjs
Local fixture: node tests/schedule-preview-server.cjs (127.0.0.1:8795)
Allowed browser origin: http://127.0.0.1:5174
Fixture login: fixture / fixture (not a real credential). Project PILOTO_FICTICIO_AGENDA.
Fixture writes append JSONL to task/test-temp/schedule-fictional-events.jsonl.
Restart reloads that file; no deletion/reset endpoint. Never put real schedules or
personal data into this fixture. It is not Google Sheets persistence verification.
