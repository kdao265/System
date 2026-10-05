// Independent TEST ONLY oracle: standalone TZif decoder and POSIX calendar.
// Does not import production parser, generator or evaluator. Date is constructed
// via setUTCFullYear, so years 0..99 retain their astronomical meaning.
import assert from 'node:assert/strict';
const civil=(y,m,d)=>{const x=new Date(0);x.setUTCFullYear(y,m-1,d);x.setUTCHours(0,0,0,0);return x.getTime()/1000;};
const seconds=s=>{const sign=s.startsWith('-')?-1:1;const [h,m=0,n=0]=s.replace(/^[+-]/,'').split(':').map(Number);return sign*(h*3600+m*60+n);};
export function oracleRule(text,y){
 const [date,time='2']=text.split('/');let t;
 if(date.startsWith('M')){const [m,w,d]=date.slice(1).split('.').map(Number),first=civil(y,m,1);
  let day=1+(d-new Date(first*1000).getUTCDay()+7)%7+(w-1)*7;
  if(day>(civil(y,m+1,1)-first)/86400)day-=7;t=civil(y,m,day);
 }else if(date.startsWith('J')){const n=+date.slice(1);t=civil(y,1,n);if(n>=60&&(civil(y,3,1)-civil(y,2,1))/86400===29)t+=86400;
 }else t=civil(y,1,1)+Number(date)*86400;
 return t+seconds(time);
}
export function oracleFooter(text,u){
 const [head,start,end]=text.split(',');
 const m=/^(<[A-Za-z0-9+-]+>|[A-Za-z]+)([+-]?\d+(?::\d+){0,2})(?:(<[A-Za-z0-9+-]+>|[A-Za-z]+)([+-]?\d+(?::\d+){0,2})?)?$/.exec(head);assert(m);
 const std=-seconds(m[2])||0,dst=m[4]===undefined?std+3600:-seconds(m[4])||0;
 if(!m[3])return {offset:std,specified:m[1]!=='<-00>'};
 const year=new Date(u*1000).getUTCFullYear();const events=[];
 for(let y=year-2;y<=year+2;y++)events.push([oracleRule(start,y)-std,dst,m[3]!=='<-00>',1],[oracleRule(end,y)-dst,std,m[1]!=='<-00>',0]);
 events.sort((a,b)=>a[0]-b[0]||a[3]-b[3]);const r=events.filter(e=>e[0]<=u).at(-1);return {offset:r[1],specified:r[2]};
}
export function decodeOracle(hex){
 const b=Buffer.from(hex,'hex');
 const block=(pos,width)=>{const [ut,st,leap,n,nt,nchar]=Array.from({length:6},(_,i)=>b.readUInt32BE(pos+20+i*4));
  const tr=pos+44,types=tr+n*(width+1),names=types+nt*6;
  return {end:names+nchar+leap*(width+4)+st+ut,
   transitions:Array.from({length:n},(_,i)=>[Number(width===8?b.readBigInt64BE(tr+i*8):b.readInt32BE(tr+i*4)),b[tr+n*width+i]]),
   types:Array.from({length:nt},(_,i)=>{const begin=names+b[types+i*6+5];const stop=b.indexOf(0,begin);return {offset:b.readInt32BE(types+i*6),specified:b.toString('ascii',begin,stop)!=='-00'};})};};
 let p=block(0,4);let footer='';if(b[4]){p=block(p.end,8);footer=b.subarray(p.end+1,b.length-1).toString('ascii');}
 return {...p,footer};
}
export function oracleOffset(z,u){
 if(z.footer&&(!z.transitions.length||u>=z.transitions.at(-1)[0]))return oracleFooter(z.footer,u);
 if(!z.transitions.length||u<z.transitions[0][0])return z.types[0];
 let lo=0,hi=z.transitions.length;while(lo+1<hi){const m=(lo+hi)>>1;if(z.transitions[m][0]<=u)lo=m;else hi=m;}
 const result=z.types[z.transitions[lo][1]];
 return !z.footer&&lo===z.transitions.length-1?{...result,specified:false}:result;
}
export function oracleResolve(z,L){
 const offsets=new Set(z.types.map(t=>t.offset));
 if(z.footer){for(const day of [15,105,195,285])offsets.add(oracleFooter(z.footer,civil(2500,1,day)).offset);}
 const hits=[];let unspecified=false;
 for(const o of offsets){const u=L-o,state=oracleOffset(z,u);if(!state.specified)unspecified=true;else if(state.offset===o)hits.push(u);}
 return {classification:unspecified?'unsupported_timezone_semantics':hits.length===0?'nonexistent_local_time':hits.length===1?'unique':'ambiguous_local_time',instant:!unspecified&&hits.length===1?hits[0]:null};
}
export function tzifFixture({types=[{offset:0,specified:true}],transitions=[],footer='UTC0',version=51}={}){
 const block=width=>{const defaultName=footer.match(/^(?:<([^>]+)>|([A-Za-z]+))/);const names=types.map((t,i)=>t.specified===false?'-00':t.abbreviation??defaultName?.[1]??defaultName?.[2]??`T${String(i).padStart(2,'0')}`),chars=Buffer.from(names.join('\0')+'\0');
  const n=transitions.length,nt=types.length,b=Buffer.alloc(44+n*(width+1)+nt*6+chars.length);b.write('TZif');b[4]=version;
  b.writeUInt32BE(n,32);b.writeUInt32BE(nt,36);b.writeUInt32BE(chars.length,40);let at=44;
  for(const [t] of transitions){if(width===8)b.writeBigInt64BE(BigInt(t),at);else b.writeInt32BE(t,at);at+=width;}
  for(const [,t] of transitions)b[at++]=t;let nameOffset=0;
  for(let i=0;i<nt;i++){b.writeInt32BE(types[i].offset,at);b[at+4]=types[i].dst?1:0;b[at+5]=nameOffset;at+=6;nameOffset+=names[i].length+1;}
  chars.copy(b,at);return b;};
 return version===0?block(4):Buffer.concat([block(4),block(8),Buffer.from(`\n${footer}\n`)]);
}
