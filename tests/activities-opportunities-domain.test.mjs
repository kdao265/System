import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/features/activities-opportunities/model.ts";
// Validation and wire boundary helpers are intentionally co-located with the pure
// domain module, matching SYSTEM's existing no-emit Node tests and tsconfig.
const v=m,c=m;
import {owner,command,linkId,link2Id,validUrls,invalidUrls,dateExamples,deadlineUnresolved,nyWinterDeadline,activityCreatedTime} from "./helpers/ao-fixtures.mjs";
const ok=x=>assert.equal(x.ok,true,JSON.stringify(x));
const bad=(x,code)=>{assert.equal(x.ok,false,JSON.stringify(x));if(code)assert.equal(x.code,code);};

test("exact L0 vocabulary, limits and independent root semantics",()=>{
  assert.deepEqual(m.OPPORTUNITY_STAGES,["saved","preparing","submitted","closed"]);
  assert.deepEqual(m.SELECTION_OUTCOMES,["unknown","pending","shortlisted","waitlisted","accepted","rejected"]);
  assert.equal(m.ENTRY_MODES.length,6);assert.equal(m.SELECTION_APPLICABILITY.length,3);
  assert.equal(m.CLOSED_REASONS.length,7);assert.equal(m.ACTIVITY_STATUSES.length,6);
  assert.equal(m.AO_MUTATIONS.length,13);assert.equal(m.AO_READS.length,7);
  assert.equal(m.MAX_RESOURCE_LINKS,30);assert.equal(m.MAX_PAGE_SIZE,100);assert.equal(m.DEFAULT_PAGE_SIZE,50);
  assert.equal(m.OPPORTUNITY_LIMITS.title,240);assert.equal(m.ACTIVITY_LIMITS.role,160);
  assert.equal(m.ACTIVITY_LIMITS.lessons,10000);assert.equal(m.RESOURCE_LABEL_LIMIT,120);
});

test("Opportunity create defaults, historical stages, hard errors, warnings stay advisory",()=>{
  const r=v.normalizeOpportunity({title:"  Học bổng 2027  "},"create");ok(r);
  assert.deepEqual([r.value.tracking_stage,r.value.selection_outcome,r.value.entry_mode,r.value.selection_applicability],["saved","unknown","unknown","unknown"]);
  assert.equal(r.value.title,"Học bổng 2027");assert.deepEqual(r.value.resource_links,[]);
  const rare=v.normalizeOpportunity({title:"Scholarship",selection_outcome:"accepted"},"create");ok(rare);
  assert.deepEqual(v.opportunityWarnings(rare.value),["saved_accepted"]);
  ok(v.normalizeOpportunity({title:"Event",tracking_stage:"submitted",entry_mode:"direct_access"},"create"));
  assert.deepEqual(v.opportunityWarnings(v.normalizeOpportunity({title:"Event",tracking_stage:"submitted",entry_mode:"direct_access"},"create").value),["submitted_without_applied_at","direct_access_submitted"]);
  ok(v.normalizeOpportunity({title:"Closed",tracking_stage:"closed",closed_reason:"declined_offer"},"create"));
  bad(v.normalizeOpportunity({title:"no",selection_applicability:"not_applicable",selection_outcome:"accepted"},"create"),"invariant");
  bad(v.normalizeOpportunity({title:"no",tracking_stage:"saved",closed_reason:"other",closed_note:"why"},"create"),"invariant");
  bad(v.normalizeOpportunity({title:"no",tracking_stage:"closed",closed_reason:"other"},"create"),"required");
  bad(v.normalizeOpportunity({title:"no",tracking_stage:"finished"},"create"),"enum");
  bad(v.normalizeOpportunity({title:"no",id:owner},"create"),"shape");
  bad(v.normalizeOpportunity({title:"no",user_id:owner},"create"),"shape");
  bad(v.normalizeOpportunity({title:"no",deadline_at_utc:"2026-11-16"},"create"),"shape");
  bad(v.normalizeOpportunity({title:" "},"create"),"required");
});

test("Opportunity PATCH omitted vs explicit unknown; no lifecycle editing through metadata",()=>{
  const empty=v.normalizeOpportunity({},"update");bad(empty,"shape");
  const x=v.normalizeOpportunity({program_start:{precision:"unknown"},organization:null},"update");ok(x);
  assert.deepEqual(x.value,{organization:null,program_start:{precision:"unknown"}});
  bad(v.normalizeOpportunity({tracking_stage:"closed"},"update"),"shape");
  bad(v.normalizeOpportunity({selection_outcome:"accepted"},"update"),"shape");
  bad(v.normalizeOpportunity({selection_applicability:"not_applicable"},"update"),"shape");
  bad(v.normalizeOpportunity({closed_reason:"other"},"update"),"shape");
  bad(v.normalizeOpportunity({decision_at:dateExamples[0]},"update"),"shape");
  assert.equal(m.opportunityStageTransition("closed","saved","advance").ok,false);
  assert.equal(m.opportunityStageTransition("closed","preparing","reopen").ok,true);
  assert.equal(m.opportunityStageTransition("saved","submitted","advance").ok,true);
  assert.equal(m.opportunityStageTransition("saved","closed","advance").ok,true);
  assert.equal(m.opportunityStageTransition("submitted","saved","advance").ok,false);
  assert.equal(m.opportunityStageTransition("submitted","saved","correction").ok,true);
  assert.equal(m.opportunityStageTransition("closed","closed","reopen").ok,false);
});

test("Activity explicit creation intent, six status transition guards, historical import",()=>{
  bad(v.normalizeActivityCreate({title:"Study group"}),"shape");
  bad(v.normalizeActivityCreate({title:"Study group",status:"upcoming",intent:"confirmed_plan"}),"shape");
  for(const [intent,expected] of [["confirmed_plan","upcoming"],["confirmed_started","ongoing"],["historical_completed","completed"],["historical_ended_early","ended_early"]]){
    const r=v.normalizeActivityCreate({title:"Study group",intent});ok(r);assert.equal(r.value.fields.status,expected);assert.equal(r.value.intent,intent);
  }
  const transitions=[
    ["upcoming","start","ongoing"],["upcoming","cancel_before_start","cancelled_before_start"],
    ["ongoing","pause","paused"],["paused","resume","ongoing"],["ongoing","complete","completed"],
    ["paused","complete","completed"],["ongoing","end_early","ended_early"],["paused","end_early","ended_early"],
  ];
  for(const [from,action,to] of transitions)assert.equal(m.activityTransition(from,action).value,to);
  for(const status of ["completed","ended_early","cancelled_before_start"])for(const action of m.ACTIVITY_ACTIONS)bad(m.activityTransition(status,action),"transition");
  bad(m.activityTransition("upcoming","complete"),"transition");
  bad(m.activityTransition("paused","start"),"transition");
  bad(v.normalizeActivityCreate({title:"Cancelled",intent:"confirmed_plan",actual_start:{precision:"day",year:2026,month:5,day:1}}),"invariant");
  ok(v.normalizeActivityCreate({title:"Started",intent:"confirmed_started",actual_start:{precision:"unknown"}}));
  bad(v.normalizeActivityUpdate({status:"completed"}),"shape");
  bad(v.normalizeActivityUpdate({participation_confirmed_at:activityCreatedTime}),"shape");
});

test("text normalization preserves Unicode, CRLF and meaningful long-text whitespace",()=>{
  assert.equal(v.unicodeCodePoints("😀"),1);
  assert.equal(v.trimBoundaryWhitespace("\u00a0\u3000Xin chào\ufeff"),"Xin chào");
  ok(v.normalizeText(" e\u0301 ","title",3,true));
  assert.equal(v.normalizeText(" a\r\nb\rc ","notes",30,false,true).value," a\nb\nc ");
  assert.equal(v.normalizeText("\u00a0 \n ","notes",30).value,null);
  bad(v.normalizeText("😀😀😀","title",2,true),"limit");
  bad(v.normalizeText("abc\ud800","title",5,true),"text");
  bad(v.normalizeText("a\0b","notes",5,false,true),"text");
  bad(v.normalizeOpportunity({title:"a".repeat(241)},"create"),"limit");
  ok(v.normalizeOpportunity({title:"😀".repeat(240)},"create"));
  bad(v.normalizeActivityCreate({intent:"confirmed_plan",title:"A",role:"a".repeat(161)}),"limit");
});

test("PartialDate exact tagged keys, leap year, Gregorian and certainty intervals",()=>{
  for(const d of dateExamples)ok(v.parsePartialDate(d));
  for(const d of [{precision:"month",year:2026,month:13},{precision:"day",year:2026,month:2,day:29},
    {precision:"day",year:1900,month:2,day:29},{precision:"day",year:2026,month:2,day:28,timezone:"UTC"},
    {precision:"year",year:"2026"},{precision:"year",year:0},{precision:"unknown",year:2026},
    {precision:"day",year:2026,month:1,day:0},{precision:"month",year:2026.2,month:1},null,[]])bad(v.parsePartialDate(d));
  ok(v.parsePartialDate({precision:"day",year:2000,month:2,day:29}));
  assert.equal(v.isCertainReverse({precision:"month",year:2026,month:9},{precision:"day",year:2026,month:8,day:31}),true);
  assert.equal(v.isCertainReverse({precision:"month",year:2026,month:9},{precision:"day",year:2026,month:9,day:1}),false);
  assert.equal(v.isCertainReverse({precision:"unknown"},{precision:"day",year:2024,month:1,day:1}),false);
  bad(v.normalizeActivityCreate({title:"Crossed",intent:"confirmed_started",planned_start:{precision:"year",year:2027},planned_end:{precision:"year",year:2026}}),"range");
  ok(v.normalizeActivityCreate({title:"Overlapping",intent:"confirmed_started",planned_start:{precision:"month",year:2027,month:6},planned_end:{precision:"day",year:2027,month:6,day:1}}));
});

test("Deadline: unresolved clock is not instant; verified offset IANA DST gaps/folds",()=>{
  const unresolved=v.parseDeadline(deadlineUnresolved);ok(unresolved);assert.equal(unresolved.value.utcMilliseconds,null);
  const winter=v.parseDeadline(nyWinterDeadline);ok(winter);
  assert.equal(new Date(winter.value.utcMilliseconds).toISOString(),"2026-11-16T04:59:00.000Z");
  const offsetOnly=v.parseDeadline({precision:"instant",source_date:"2026-11-15",source_time:"23:59",source_offset_minutes:420});ok(offsetOnly);
  assert.equal(new Date(offsetOnly.value.utcMilliseconds).toISOString(),"2026-11-15T16:59:00.000Z");
  bad(v.parseDeadline({precision:"day",year:2026,month:11,day:15,source_time:"23:59"}));
  bad(v.parseDeadline({...deadlineUnresolved,source_offset_minutes:0}));
  bad(v.parseDeadline({...nyWinterDeadline,source_offset_minutes:-240}),"timezone");
  bad(v.parseDeadline({...nyWinterDeadline,deadline_at_utc:"2026-11-16T04:59Z"}),"shape");
  bad(v.parseDeadline({precision:"instant",source_date:"2026-03-08",source_time:"02:30",source_zone:"America/New_York",source_offset_minutes:-300}),"timezone");
  for(const [offset,expected] of [[-240,"2026-11-01T05:30:00.000Z"],[-300,"2026-11-01T06:30:00.000Z"]]){
    const fold=v.parseDeadline({precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_zone:"America/New_York",source_offset_minutes:offset});ok(fold);
    assert.equal(new Date(fold.value.utcMilliseconds).toISOString(),expected);
  }
  bad(v.parseDeadline({precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_zone:"America/New_York"}));
  bad(v.parseDeadline({precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_offset_minutes:1000}),"timezone");
  bad(v.parseDeadline({precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_zone:"Invalid/Zone",source_offset_minutes:0}),"timezone");
  bad(v.parseDeadline({precision:"instant",source_date:"2026-02-29",source_time:"01:30",source_offset_minutes:0}),"time");
  const prep=v.normalizeOpportunity({title:"Late",tracking_stage:"preparing"},"create");ok(prep);
  assert.deepEqual(v.opportunityWarnings(prep.value,{applicationDeadline:nyWinterDeadline,nowUtcMilliseconds:Date.UTC(2026,10,17)}),["deadline_past_preparing"]);
  assert.deepEqual(v.opportunityWarnings(prep.value,{applicationDeadline:deadlineUnresolved,nowUtcMilliseconds:Date.UTC(2026,10,17)}),[]);
});

test("Resource Links are ordered, UUID-stable, capped; invalid members reject atomically",()=>{
  for(const url of validUrls) assert.equal(v.isResourceUrl(url),true,url);
  for(const url of invalidUrls) assert.equal(v.isResourceUrl(url),false,JSON.stringify(url));
  const ordered=[{id:link2Id,label:"  Ưu tiên  ",url:validUrls[0]},{id:linkId,label:"Tài liệu",url:validUrls[0]}];
  const checked=v.parseResourceLinks(ordered);ok(checked);assert.deepEqual(checked.value.map(l=>l.id),[link2Id,linkId]);
  assert.equal(checked.value[0].label,"Ưu tiên");
  ok(v.parseResourceLinks(Array.from({length:30},(_,i)=>({id:`550e8400-e29b-41d4-a716-${String(446655440000+i).padStart(12,"0")}`,label:"link",url:validUrls[0]}))));
  bad(v.parseResourceLinks(Array.from({length:31},(_,i)=>({id:String(i)}))),"shape");
  bad(v.parseResourceLinks([{...ordered[0]},{...ordered[0],id:link2Id.toUpperCase()}]),"duplicate");
  bad(v.parseResourceLinks([{...ordered[0],label:" "}]),"required");
  bad(v.parseResourceLinks([{...ordered[0],url:"http://example.invalid"}]),"url");
  bad(v.parseResourceLinks([{...ordered[0],title:"unsafe"}]),"shape");
  bad(v.normalizeOpportunity({title:"A",resource_links:[ordered[0],{...ordered[1],url:"data:bad"}]},"create"),"url");
});

test("revision bounds, strict command identity, deterministic canonical intent and receipt replay",()=>{
  assert.equal(m.isRevision("9223372036854775807"),true);
  for(const value of ["0","00","1.5","9223372036854775808",3,0,"-1",null])assert.equal(m.isRevision(value),false);
  const id={command_id:command,subject_kind:"opportunity",subject_id:owner,operation:"update_opportunity_v1",expected_revision:"7"};
  assert.equal(c.isCommandIdentity(id),true);
  assert.equal(c.isCommandIdentity({...id,subject_kind:"activity"}),false);
  assert.equal(c.isCommandIdentity({...id,expected_revision:null}),false);
  assert.equal(c.isCommandIdentity({...id,operation:"create_opportunity_v1",expected_revision:"7"}),false);
  const a=c.canonicalAoIntent({...id,request:{z:[2,1],a:{y:"A",b:7}}});
  const b=c.canonicalAoIntent({...id,request:{a:{b:7,y:"A"},z:[2,1]}});
  assert.equal(a,b);assert.notEqual(a,c.canonicalAoIntent({...id,request:{z:[1,2],a:{y:"A",b:7}}}));
  assert.equal(c.canonicalAoIntent({...id,request:{x:NaN}}),null);
  assert.equal(c.canonicalAoIntent({...id,request:{x:1.2}}),null);
  const receipt={version:1,...id,revision_before:"7",revision_after:"8",changed:true,replay:false};delete receipt.expected_revision;
  assert.ok(c.parseAoReceipt(receipt,id));
  assert.ok(c.parseAoReceipt({...receipt,replay:true},id));
  assert.equal(c.parseAoReceipt({...receipt,revision_after:"9"},id),null);
  assert.equal(c.parseAoReceipt({...receipt,subject_id:command},id),null);
  assert.equal(c.parseAoReceipt({...receipt,extra:1},id),null);
  assert.ok(c.parseAoReceipt({...receipt,changed:false,revision_after:"7"},id));
  const createId={...id,operation:"create_opportunity_v1",expected_revision:null};
  assert.ok(c.parseAoReceipt({...receipt,operation:createId.operation,revision_before:"0",revision_after:"1"},createId));
});

test("Root DTO and list envelope are closed, owner-safe and bounded",()=>{
  const row={version:1,subject_kind:"opportunity",id:owner,revision:"7",archived_at:null,created_at:activityCreatedTime,updated_at:activityCreatedTime};
  assert.ok(c.parseAoRootDto(row));
  assert.equal(c.parseAoRootDto({...row,title:"private"}),null);
  assert.equal(c.parseAoRootDto({...row,revision:7}),null);
  assert.equal(c.parseAoRootDto({...row,archived_at:"2025-01-01T10:00:00Z"}),null);
  assert.equal(c.parseAoRootDto({...row,created_at:"2026-02-31T10:30:00Z"}),null);
  assert.equal(c.parseAoRootDto({...row,created_at:"2026-10-10T25:00:00Z"}),null);
  assert.equal(c.parseAoRootDto({...row,created_at:"2026-10-10T10:30:00+15:00"}),null);
  assert.ok(c.parseAoRootDto({...row,created_at:"2026-10-10T10:30:00.000001Z",updated_at:"2026-10-10T10:30:00.000002Z"}));
  assert.equal(c.parseAoRootDto({...row,created_at:"2026-10-10T10:30:00.000002Z",updated_at:"2026-10-10T10:30:00.000001Z"}),null);
  const page={version:1,items:[row],next_cursor:{created_at:activityCreatedTime,id:owner}};
  assert.ok(c.parseAoIdentityPage(page));
  assert.equal(c.parseAoIdentityPage({...page,items:[row,row]}),null);
  assert.equal(c.parseAoIdentityPage({...page,next_cursor:{created_at:activityCreatedTime,id:linkId}}),null);
  assert.equal(c.parseAoIdentityPage({...page,items:[]}),null);
  const a={...row,id:linkId,created_at:"2026-10-10T10:30:00.000002Z",updated_at:"2026-10-10T10:30:00.000002Z"};
  const b={...row,id:link2Id,created_at:"2026-10-10T10:30:00.000001Z",updated_at:"2026-10-10T10:30:00.000001Z"};
  assert.ok(c.parseAoIdentityPage({version:1,items:[a,b],next_cursor:{created_at:b.created_at,id:b.id}}));
  assert.equal(c.parseAoIdentityPage({version:1,items:[b,a],next_cursor:{created_at:a.created_at,id:a.id}}),null);
});

test("F-01: list cards include exact metadata and exclude private fields", () => {
  const base={version:1,subject_kind:"opportunity",id:"11111111-1111-4111-8111-111111111111",
    revision:"1",archived_at:null,created_at:"2026-10-10T01:00:00.000001Z",updated_at:"2026-10-10T01:00:00.000001Z"};
  const opportunity={...base,title:"Học bổng",category:"scholarship",organization:"Trường ABC",tracking_stage:"saved",selection_outcome:"unknown"};
  const activity={...base,id:"22222222-2222-4222-8222-222222222222",subject_kind:"activity",
    title:"Dự án",category:"project",organization:null,status:"ongoing"};
  assert.equal(c.parseAoRootDto(opportunity),null,"minimal identity DTO still rejects extra fields");
  assert.deepEqual(c.parseAoListItem(opportunity),opportunity);
  assert.deepEqual(c.parseAoListItem(activity),activity);
  for(const bad of [{...opportunity,description:"private"},{...activity,notes:"private"},
    {...opportunity,tracking_stage:"bad"},{...activity,status:"bad"},
    {...opportunity,title:" "},{...activity,organization:"  padded "}])
    assert.equal(c.parseAoListItem(bad),null);
  assert.deepEqual(c.parseAoListPage({version:1,items:[opportunity],next_cursor:null})?.items,[opportunity]);
  assert.equal(c.parseAoListPage({version:1,items:[opportunity,opportunity],next_cursor:null}),null);
  assert.equal(c.parseAoListPage({version:1,items:[opportunity,activity],next_cursor:null}),null,
    "reject out-of-order identical timestamps and UUIDs");
});


test("R-01/R-02: multiline notes share canonical LF and Unicode length boundaries",()=>{
  const closed=v.normalizeOpportunity({title:"Closed",tracking_stage:"closed",closed_reason:"other",closed_note:"Vòng 1\r\nVòng 2\rKết thúc"},"create");
  ok(closed);assert.equal(closed.value.closed_note,"Vòng 1\nVòng 2\nKết thúc");
  const blank=v.normalizeOpportunity({title:"Closed",tracking_stage:"closed",closed_reason:"other",closed_note:" \r\n "},"create");
  bad(blank,"required");
  const confirmed=v.normalizeActivityCreate({intent:"confirmed_plan",title:"Study",confirmation_note:"Đi học\r\nTrực tuyến"});
  ok(confirmed);assert.equal(confirmed.value.fields.confirmation_note,"Đi học\nTrực tuyến");
  const cap=v.normalizeActivityCreate({intent:"confirmed_plan",title:"Study",confirmation_note:"😀".repeat(2000)});
  ok(cap);bad(v.normalizeActivityCreate({intent:"confirmed_plan",title:"Study",confirmation_note:"😀".repeat(2001)}),"limit");
  bad(v.normalizeOpportunity({title:"Closed",tracking_stage:"closed",closed_reason:"other",closed_note:"a".repeat(2001)},"create"),"limit");
});

test("R-03: bounded derived preview is explicitly incomplete when more than 50 items",()=>{
  const id="11111111-1111-4111-8111-111111111111";
  const item=(n)=>({id:`${n.toString(16).padStart(8,"0")}-1111-4111-8111-111111111111`,title:`Activity ${n}`,status:"ongoing",archived:n%2===0});
  const empty={items:[],has_more:false,continuation:null};
  assert.deepEqual(m.parseAoDerivedActivityPreview(empty,id),empty);
  const complete={items:[item(1),item(2)],has_more:false,continuation:null};
  assert(m.parseAoDerivedActivityPreview(complete,id));
  const continuation={rpc:"list_activities_v1",filters:{source_opportunity_id:id},scopes:["active","archived"]};
  const truncated={items:Array.from({length:50},(_,i)=>item(i+1)),has_more:true,continuation};
  assert(m.parseAoDerivedActivityPreview(truncated,id));
  assert.equal(m.parseAoDerivedActivityPreview({...truncated,items:truncated.items.slice(1)},id),null);
  assert.equal(m.parseAoDerivedActivityPreview({...truncated,continuation:{...continuation,scopes:["active"]}},id),null);
  assert.equal(m.parseAoDerivedActivityPreview({...truncated,continuation:{...continuation,filters:{source_opportunity_id:item(1).id}}},id),null);
  assert.equal(m.parseAoDerivedActivityPreview({...complete,continuation},id),null);
  assert.equal(m.parseAoDerivedActivityPreview({...complete,items:[item(1),item(1)]},id),null);
});
