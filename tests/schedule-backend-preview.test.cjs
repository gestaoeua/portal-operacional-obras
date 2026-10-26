const {test}=require('node:test'),assert=require('node:assert/strict');
const {route}=require('./schedule-preview-server.cjs');
test('fixture OS sources are explicitly empty',()=>{assert.deepEqual(route({action:'listOsMembers',token:'fixture-manager'}),{ok:true,members:[]});assert.deepEqual(route({action:'listOsOperacional',token:'fixture-manager'}),{ok:true,workOrders:[]});});
test('fixture never pretends to save OS',()=>{for(const action of ['createOsOperacional','assignOsOperacional','advanceOsOperacional','reopenOsOperacional'])assert.equal(route({action,token:'fixture-manager'}).code,'FIXTURE_MODULE_NOT_ENABLED');});
test('fixture login has explicit synthetic identity and refuses other credentials',()=>{assert.match(route({action:'login',username:'fixture',password:'fixture'}).session.name,/SIMULAÇÃO LOCAL/);assert.equal(route({action:'login',username:'other',password:'other'}).ok,false);});
