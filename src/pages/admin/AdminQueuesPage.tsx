import { FormEvent, useState } from 'react'
import { Card, Field, inputClass, PageHeader, btnGhost, btnPrimary } from '../../components/ui'
import { useDb } from '../../hooks/useDb'
import { newId, removeRecord, upsertRecord } from '../../lib/store'
import type { QueueCriterion, TicketQueue } from '../../types'

const choices = {
  status: [{value:'open',label:'Open'},{value:'pending',label:'Pending'},{value:'closed',label:'Closed'}],
  priority: [{value:'low',label:'Low'},{value:'normal',label:'Normal'},{value:'high',label:'High'},{value:'emergency',label:'Emergency'}],
  source: [{value:'web',label:'Web'},{value:'email',label:'Email'},{value:'phone',label:'Phone'}],
}
export function AdminQueuesPage() {
  const db=useDb()
  const [editing,setEditing]=useState<TicketQueue|null>(null)
  function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form=new FormData(e.currentTarget)
    const criteria:QueueCriterion[]=[]
    for(const field of ['status','priority','deptId','assignee','overdue','source'] as const) {
      const value=String(form.get(field)||'')
      if(value) criteria.push({field,op:'eq',value})
    }
    const queue:TicketQueue={id:editing?.id??newId(),title:String(form.get('title')).trim(),sort:editing?.sort??db.queues.length+1,enabled:form.get('enabled')==='on',criteria,sortBy:String(form.get('sortBy')) as TicketQueue['sortBy'],notes:String(form.get('notes')||'')}
    upsertRecord('queues',queue)
    setEditing(null)
  }
  return <div>
    <PageHeader title="Custom ticket queues" subtitle="Save AND filters for agents and choose how matching tickets are sorted." actions={<button className={btnPrimary} onClick={()=>setEditing({id:'',title:'',sort:db.queues.length+1,enabled:true,criteria:[],sortBy:'updatedDesc'})}>Create queue</button>} />
    {editing ? <Card className="mb-5"><form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <Field label="Queue name"><input name="title" required maxLength={60} defaultValue={editing.title} className={inputClass}/></Field>
      <Field label="Sort results"><select name="sortBy" defaultValue={editing.sortBy} className={inputClass}><option value="updatedDesc">Recently updated</option><option value="updatedAsc">Least recently updated</option><option value="createdDesc">Newest created</option><option value="priorityDesc">Highest priority</option><option value="numberAsc">Ticket number</option></select></Field>
      <Field label="Status"><select name="status" defaultValue={editing.criteria.find(c=>c.field==='status')?.value??''} className={inputClass}><option value="">Any status</option>{choices.status.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
      <Field label="Priority"><select name="priority" defaultValue={editing.criteria.find(c=>c.field==='priority')?.value??''} className={inputClass}><option value="">Any priority</option>{choices.priority.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
      <Field label="Department"><select name="deptId" defaultValue={editing.criteria.find(c=>c.field==='deptId')?.value??''} className={inputClass}><option value="">Any department</option>{db.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="Assignee"><select name="assignee" defaultValue={editing.criteria.find(c=>c.field==='assignee')?.value??''} className={inputClass}><option value="">Any assignee</option><option value="mine">Current agent</option><option value="unassigned">Unassigned</option>{db.users.filter(u=>u.role==='agent'||u.role==='admin').map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      <Field label="Overdue"><select name="overdue" defaultValue={editing.criteria.find(c=>c.field==='overdue')?.value??''} className={inputClass}><option value="">Any</option><option value="true">Overdue</option><option value="false">Not overdue</option></select></Field>
      <Field label="Source"><select name="source" defaultValue={editing.criteria.find(c=>c.field==='source')?.value??''} className={inputClass}><option value="">Any source</option>{choices.source.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
      <Field label="Notes"><input name="notes" defaultValue={editing.notes} className={inputClass}/></Field>
      <Field label="Enabled"><input name="enabled" type="checkbox" defaultChecked={editing.enabled} className="h-4 w-4"/></Field>
      <div className="flex gap-2 sm:col-span-2"><button className={btnPrimary}>Save queue</button><button type="button" className={btnGhost} onClick={()=>setEditing(null)}>Cancel</button></div>
    </form></Card>:null}
    <ul className="grid gap-3">{db.queues.map(q=><li key={q.id}><Card className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="font-semibold">{q.title}{!q.enabled?<span className="ml-2 text-xs text-ink-400">Disabled</span>:null}</div><p className="mt-1 text-sm text-ink-600">{q.criteria.length?q.criteria.map(c=>{const val=c.field==='deptId'?db.departments.find(d=>d.id===c.value)?.name:c.field==='assignee'?c.value==='mine'?'Current agent':c.value==='unassigned'?'Unassigned':db.users.find(u=>u.id===c.value)?.name:c.value;return c.field+': '+(val||'')}).join(' · '):'No filters'} · {q.sortBy}</p>{q.notes?<p className="mt-1 text-sm text-ink-500">{q.notes}</p>:null}</div><div className="flex gap-2"><button className={btnGhost} onClick={()=>setEditing(q)}>Edit</button><button className={btnGhost} onClick={()=>{if(confirm('Delete this custom queue?')) removeRecord('queues',q.id)}}>Delete</button></div></Card></li>)}{db.queues.length===0?<li><Card>No custom queues yet.</Card></li>:null}</ul>
  </div>
}
