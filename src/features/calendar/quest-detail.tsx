"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/localization/provider";
import { useOnline } from "@/features/network/network-status";
import { QuestPlanProvider, QuestPlanRecoveryNotice, usePlanRecovery } from "@/features/quests/plan-provider";
import { readOccurrenceDetail } from "@/features/quests/plan-actions";
import { OccurrenceReadGeneration, preparePlan, type OccurrenceDetail } from "@/features/quests/plan-model";
import { utcToLocalInput } from "@/features/quests/time";
import { todayInTimezone } from "@/features/quests/dates";

const Selection=createContext<((id:string,trigger:HTMLElement)=>void)|null>(null);
const button="ui-button min-h-11 max-w-full";
const input="mt-1 block min-h-11 w-full min-w-0 max-w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-2 text-base";
export function CalendarQuestDetails({userId,timezone,children}:{userId:string;timezone:string;children:ReactNode}){
  const [selected,setSelected]=useState<string|null>(null),trigger=useRef<HTMLElement|null>(null);
  // A modal dialog makes the rest of the page inert, so its opener can only take focus back
  // after the dialog has closed and unmounted; focusing it while the dialog is still open
  // would silently do nothing.
  useEffect(()=>{
    const element=trigger.current;
    if(selected!==null||!element)return;
    trigger.current=null;
    if(element.isConnected)element.focus();
  },[selected]);
  return <QuestPlanProvider userId={userId}><Selection.Provider value={(id,element)=>{trigger.current=element;setSelected(id);}}>
    <QuestPlanRecoveryNotice />{children}
    {selected!==null&&<QuestDetailModal key={`${userId}:${selected}`} occurrenceId={selected} userId={userId} timezone={timezone} close={()=>setSelected(null)}/>}
  </Selection.Provider></QuestPlanProvider>;
}
export function QuestDetailTrigger({id,children,className,style,label}:{id:string;children:ReactNode;className?:string;style?:React.CSSProperties;label?:string}){
  const open=useContext(Selection);
  return <button type="button" aria-label={label} aria-haspopup="dialog" className={className??button} style={style}
    onClick={event=>open?.(id,event.currentTarget)}>{children}</button>;
}
export function QuestDetailLink({id}:{id:string}){
  const {messages,locale}=useLocale();return <QuestDetailTrigger id={id}><span lang={locale}>{messages.questDetail.title}</span></QuestDetailTrigger>;
}
function QuestDetailModal({occurrenceId,userId,timezone,close}:{occurrenceId:string;userId:string;timezone:string;close:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const {messages,locale}=useLocale(),{state}=usePlanRecovery(),t=messages.questDetail;
  const [generation]=useState(()=>new OccurrenceReadGeneration());
  const [nonce,setNonce]=useState(0);
  const [loaded,setLoaded]=useState<{detail:OccurrenceDetail|null;nonce:number;result:typeof state.result}|null>(null);
  const result=state.result;
  useEffect(()=>{
    const element=dialog.current!;element.showModal();closeButton.current?.focus();
    const previous=document.body.style.overflow;document.body.style.overflow="hidden";
    return()=>{element.close();document.body.style.overflow=previous;};
  },[]);
  useEffect(()=>{
    const token=generation.begin();
    void readOccurrenceDetail(userId,occurrenceId).then(detail=>{
      if(generation.accepts(token))setLoaded({detail,nonce,result});
    }).catch(()=>{if(generation.accepts(token))setLoaded({detail:null,nonce,result});});
    return()=>generation.cancel();
  },[generation,occurrenceId,userId,nonce,result]);
  const loading=!loaded||loaded.nonce!==nonce||loaded.result!==result;
  const d=loading?null:loaded.detail;
  const stamp=(v:string|null)=>v?new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(new Date(v)):t.unset;
  return <dialog ref={dialog} lang={locale} aria-labelledby="quest-detail-title" onCancel={e=>{e.preventDefault();close();}}
    onKeyDown={e=>{
      if(e.key!=="Tab")return;
      const targets=Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]')).filter(el=>el.getClientRects().length);
      const first=targets[0],last=targets.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }}
    className="m-auto max-h-[calc(100dvh-1rem)] min-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl overflow-y-auto rounded-xl border border-violet-400/40 bg-zinc-950 p-4 text-zinc-100 shadow-2xl backdrop:bg-black/75 sm:min-h-0 sm:p-6">
    <div className="flex items-start justify-between gap-3"><h2 id="quest-detail-title" className="text-lg font-semibold">{t.title}</h2><button ref={closeButton} className={button} onClick={close}>{t.close}</button></div>
    {loading?<p role="status" className="mt-4">{t.loading}</p>:!d?<div className="mt-4"><p role="alert">{t.error}</p><button className={`${button} mt-3`} onClick={()=>setNonce(n=>n+1)}>{t.retry}</button></div>:<>
      <h3 className="mt-4 text-xl font-semibold wrap-anywhere">{d.title}</h3>
      <p className="mt-2 text-xs text-zinc-400 wrap-anywhere">{t.timezone}: {timezone}</p>
      <dl className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-3 gap-y-2 text-sm [&_dd]:wrap-anywhere [&_dt]:text-zinc-400">
        <dt>{t.date}</dt><dd>{d.scheduled_at?todayInTimezone(timezone,new Date(d.scheduled_at)):d.source_slot_date??t.unset}</dd>
        <dt>{t.plannedStart}</dt><dd>{stamp(d.scheduled_at)}</dd><dt>{t.plannedEnd}</dt><dd>{d.planned_end_at?stamp(d.planned_end_at):t.endNotSet}</dd>
        <dt>{t.deadline}</dt><dd>{stamp(d.deadline_at)}</dd><dt>{t.status}</dt><dd>{messages.daily.states[d.status]}</dd>
        <dt>{t.reward}</dt><dd>{d.reward_exp_snapshot??t.unset}</dd><dt>{t.duration}</dt><dd>{d.estimated_duration_minutes_snapshot??t.unset}</dd>
      </dl>
      {[[t.description,d.description],[t.notes,d.notes]].map(([label,value])=>value&&<div key={label} className="mt-4"><h4 className="text-sm text-zinc-400">{label}</h4><p className="mt-1 whitespace-pre-wrap text-sm wrap-anywhere">{value}</p></div>)}
      {d.rule&&<section className="mt-4 space-y-1 text-sm wrap-anywhere"><h4 className="font-semibold">{t.recurrence}</h4>
        <p>{t.currentRule}: {t[d.rule.recurrence_type as "daily"]} · {d.rule.paused?t.paused:t.running} · {t.revision} {d.rule.revision}</p>
        <p>{t.anchor}: {d.rule.anchor_date} · {t.seriesEnd}: {d.rule.end_date??t.unset}</p>
        {d.rule.weekdays&&<p>{t.weekdays}: {d.rule.weekdays.join(", ")}</p>}{d.rule.month_day&&<p>{t.monthDay}: {d.rule.month_day}</p>}
        {d.rule.interval_count&&<p>{t.interval}: {d.rule.interval_count}</p>}{d.rule.occurrence_limit&&<p>{t.limit}: {d.rule.occurrence_limit}</p>}
        <p>{t.provenance}: {d.source_slot_date} · {d.source_timezone} · {t.revision} {d.recurrence_revision}</p>
      </section>}
      {d.goal&&<p className="mt-4 text-sm wrap-anywhere">{t.mainQuest}: <a className="underline" href={`/goals?id=${d.goal.id}${d.goal.archived?"&scope=archived":""}`}>{d.goal.title}</a>{d.goal.archived?` · ${t.archived}`:""}</p>}
      <QuestPlanRecoveryNotice refresh={false}/>
      {state.result&&<p role={state.result.outcome==="rejected"?"alert":"status"} className="mt-3 text-sm text-amber-200">{state.result.outcome==="success"?t.saved:state.result.outcome==="unknown"?t.unknown:state.result.reason==="deadline"?t.deadlineError:state.result.reason==="stale"?t.stale:state.result.reason==="conflict"?t.conflict:t.retired}</p>}
      {d.plannable?<PlanForm key={`${d.occurrence_id}:${d.execution_cycle}:${d.scheduled_at}:${d.planned_end_at}:${nonce}`} detail={d} userId={userId} timezone={timezone}/>:<p className="mt-4 text-sm text-zinc-400">{t.readOnly}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><button className={button} onClick={()=>setNonce(n=>n+1)}>{t.reload}</button>
        <a className={button} href={`/dashboard?date=${d.source_slot_date??(d.scheduled_at?todayInTimezone(timezone,new Date(d.scheduled_at)):todayInTimezone(timezone))}`}>{t.openQuest}</a></div>
    </>}
  </dialog>;
}
function PlanForm({detail:d,userId,timezone}:{detail:OccurrenceDetail;userId:string;timezone:string}){
  const {messages}=useLocale(),t=messages.questDetail,{controller,state}=usePlanRecovery(),online=useOnline();
  const [start,setStart]=useState(d.scheduled_at?utcToLocalInput(d.scheduled_at,timezone):""),[end,setEnd]=useState(d.planned_end_at?utcToLocalInput(d.planned_end_at,timezone):"");
  const [invalid,setInvalid]=useState(false);
  const disabled=state.blocked||state.busy||!!state.pending||!online;
  return <details className="mt-5"><summary className={`${button} cursor-pointer`}>{t.plan}</summary><form className="mt-3 space-y-3" onSubmit={event=>{
    event.preventDefault();if(disabled)return;
    const plan=preparePlan(start,end,timezone);if(!plan){setInvalid(true);return;}setInvalid(false);
    void controller.submit({userId,commandId:crypto.randomUUID(),occurrenceId:d.occurrence_id,executionCycle:d.execution_cycle,
      expectedStart:d.scheduled_at,expectedEnd:d.planned_end_at,...plan});
  }}>
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <label className="block text-sm">{t.plannedStart}<input className={input} type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label className="block text-sm">{t.plannedEnd}<input className={input} type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <p className="text-xs text-zinc-400">{t.intervalHint}</p><button className={button}>{state.busy?t.saving:t.save}</button>
    </fieldset>{invalid&&<p role="alert" className="text-sm text-amber-200">{t.invalid}</p>}
  </form></details>;
}
