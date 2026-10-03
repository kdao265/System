import { validPlanRequest, type PlanRequest, type PlanResult } from "./plan-model";
export const PLAN_PREFIX="system.quest-plan.v1:";
export type PlanState={pending:PlanRequest|null;busy:boolean;blocked:boolean;result:PlanResult|null};
export const initialPlanState:PlanState={pending:null,busy:false,blocked:true,result:null};
type Dependencies={storage:()=>Storage;lock:<T>(name:string,work:()=>Promise<T>)=>Promise<T>;send:(r:PlanRequest,retry:boolean)=>Promise<PlanResult>};
export class PlanRecovery {
  private state:PlanState=initialPlanState;
  private listeners=new Set<()=>void>();
  private active=true;
  private userId:string;
  private dependencies:Dependencies;
  constructor(userId:string,dependencies:Dependencies){this.userId=userId;this.dependencies=dependencies;}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  getSnapshot=()=>this.state;
  private set(p:Partial<PlanState>){this.state={...this.state,...p};this.listeners.forEach(fn=>fn());}
  private key(){return PLAN_PREFIX+this.userId;}
  private read(){
    const text=this.dependencies.storage().getItem(this.key());
    if(text===null)return null;
    const r:unknown=JSON.parse(text);
    if(!validPlanRequest(r)||r.userId!==this.userId)throw new Error("Invalid saved plan");
    return r;
  }
  recover=()=>{if(!this.active||this.state.busy)return;try{this.set({pending:this.read(),blocked:false});}catch{this.set({blocked:true});}};
  deactivate=()=>{this.active=false;this.set({blocked:true});};
  activate=()=>{this.active=true;};
  async submit(request?:PlanRequest){
    if(!this.active||this.state.busy||this.state.blocked)return;
    this.set({busy:true,result:null});
    try{
      await this.dependencies.lock(this.key(),async()=>{
        if(!this.active)return;
        const saved=this.read();
        // Another tab's pending operation always wins. Never replace it with a new one.
        if(request&&saved){this.set({pending:saved});return;}
        const r=saved??request;
        if(!r||!validPlanRequest(r)||r.userId!==this.userId)throw new Error("Invalid plan");
        this.dependencies.storage().setItem(this.key(),JSON.stringify(r));
        if(JSON.stringify(this.read())!==JSON.stringify(r))throw new Error("Plan was not retained");
        this.set({pending:r});
        let result:PlanResult;
        try{result=await this.dependencies.send(r,!!saved);}catch{result={outcome:"unknown"};}
        if(!this.active)return;
        if(result.reason==="account"){this.deactivate();return;}
        if(result.outcome!=="unknown"){
          this.dependencies.storage().removeItem(this.key());
          if(this.dependencies.storage().getItem(this.key())!==null)throw new Error("Plan cleanup failed");
          this.set({pending:null});
        }
        this.set({result});
      });
    }catch{this.set({blocked:true});}finally{this.set({busy:false});}
  }
}
