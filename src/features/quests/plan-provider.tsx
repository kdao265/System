"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/localization/provider";
import { useOnline } from "@/features/network/network-status";
import { PlanRecovery, PLAN_PREFIX, initialPlanState } from "./plan-recovery";
import { saveOccurrencePlan } from "./plan-actions";

const Context=createContext<PlanRecovery|null>(null);
export function usePlanRecovery(){
  const controller=useContext(Context);
  if(!controller)throw new Error("Planning requires an account provider");
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,()=>initialPlanState);
  return {controller,state};
}
export function QuestPlanProvider({userId,children}:{userId:string;children:ReactNode}){
  return <AccountProvider key={userId} userId={userId}>{children}</AccountProvider>;
}
function AccountProvider({userId,children}:{userId:string;children:ReactNode}){
  const [controller]=useState(()=>new PlanRecovery(userId,{
    storage:()=>window.localStorage,
    lock:async(name,work)=>{if(!navigator.locks)throw new Error("Coordination unavailable");return navigator.locks.request(name,work);},
    send:saveOccurrencePlan,
  }));
  useEffect(()=>{
    controller.activate();controller.recover();
    const storage=(e:StorageEvent)=>{if(e.key===null||e.key===PLAN_PREFIX+userId)controller.recover();};
    const focus=()=>controller.recover();
    window.addEventListener("storage",storage);window.addEventListener("focus",focus);
    const {data}=createSupabaseClient().auth.onAuthStateChange((_event,session)=>{
      if(session?.user.id!==userId)controller.deactivate();
    });
    return()=>{controller.deactivate();window.removeEventListener("storage",storage);window.removeEventListener("focus",focus);data.subscription.unsubscribe();};
  },[controller,userId]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function QuestPlanRecoveryNotice({refresh=true}:{refresh?:boolean}){
  const {controller,state}=usePlanRecovery(),{messages,locale}=useLocale(),online=useOnline(),router=useRouter();
  const t=messages.questDetail;
  useEffect(()=>{if(refresh&&state.result?.outcome==="success")router.refresh();},[state.result,router,refresh]);
  if(state.blocked)return <p lang={locale} role="alert" className="mt-3 text-sm text-amber-200">{t.blocked}</p>;
  if(!state.pending)return null;
  return <section lang={locale} aria-label={t.recovery} className="my-3 rounded-lg border border-amber-700 p-3 text-sm">
    <p role="status">{state.result?.outcome==="unknown"?t.unknown:t.pendingHint}</p>
    <button type="button" className="ui-button mt-2 min-h-11" disabled={state.busy||!online} onClick={()=>void controller.submit()}>{state.busy?t.saving:t.retrySaved}</button>
  </section>;
}
