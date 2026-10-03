"use client";
import { useLocale } from "@/lib/localization/provider";
import type { CalendarEntry } from "./model";
import { QuestDetailTrigger } from "./quest-detail";

export function TimelineItem({entry,timezone}:{entry:CalendarEntry;timezone:string}){
  const {messages,locale}=useLocale(),t=messages.questDetail;
  const clock=(v:string)=>new Intl.DateTimeFormat(locale,{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:timezone}).format(new Date(v));
  const date=(v:string)=>new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:timezone}).format(new Date(v));
  const continuation=!!entry.start_at&&!!entry.end_at&&date(entry.start_at)!==date(entry.end_at);
  const time=entry.start_at?`${clock(entry.start_at)}${entry.end_at?`–${clock(entry.end_at)}`:` · ${t.endNotSet}`}`:t.untimed;
  const quest=entry.source==="quest_occurrence";
  const label=`${entry.title} · ${time}${continuation?` · ${t.continuation}`:""}`;
  const content=<><span className="block truncate font-semibold">{entry.title}</span><span className="block truncate text-[10px]">{time}</span>
    {entry.status&&<span className="block truncate text-[10px] opacity-80">{messages.daily.states[entry.status as keyof typeof messages.daily.states]}</span>}
    {continuation&&<span className="block truncate text-[10px]">{t.continuation}</span>}</>;
  const className=`block w-full min-w-0 text-left text-[11px] leading-tight focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-white ${entry.end_at?"h-full overflow-hidden border-l-2 p-0.5":"absolute top-0 border-t-2 bg-zinc-950 px-0.5"} ${quest?"border-cal-quest text-violet-100":"border-cal-event text-sky-100"} ${entry.end_at?(quest?"bg-violet-950/90":"bg-sky-950/90"):""} ${entry.status==="completed"?"opacity-60":""}`;
  return quest?<QuestDetailTrigger id={entry.entry_id} label={label} className={className}>{content}</QuestDetailTrigger>
    :<div title={label} className={className}>{content}</div>;
}
export function QuestBandChip({entry}:{entry:CalendarEntry}){
  const {messages}=useLocale();
  return <li className="min-w-0 border-l-2 border-cal-quest bg-cal-quest/15 px-1">
    <QuestDetailTrigger id={entry.entry_id} label={`${entry.title} · ${messages.questDetail.untimed}`} className="block w-full truncate text-left text-[11px] text-violet-100 focus-visible:outline-2 focus-visible:outline-white">{entry.title}</QuestDetailTrigger>
  </li>;
}
