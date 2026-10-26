import type { Database, Message, Ticket } from '../types'
import { formatDate } from './format'

export function printTicket(ticket: Ticket, messages: Message[], db: Database) {
  const owner = db.users.find((u) => u.id === ticket.userId)
  const dept = db.departments.find((d) => d.id === ticket.deptId)
  const topic = db.topics.find((t) => t.id === ticket.topicId)
  const assignee = ticket.assigneeId ? db.users.find((u) => u.id === ticket.assigneeId) : undefined
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ticket #${ticket.number}</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#111;line-height:1.5}
h1{font-size:1.25rem;margin:0 0 .5rem}
.meta{color:#555;font-size:.875rem;margin-bottom:1.5rem}
.msg{border-top:1px solid #ddd;padding:1rem 0}
.msg h3{margin:0 0 .25rem;font-size:.95rem}
.msg time{color:#666;font-size:.8rem}
.internal{background:#fffbeb;padding:.75rem;border-radius:.5rem}
</style></head><body>
<h1>#${ticket.number} — ${escapeHtml(ticket.subject)}</h1>
<div class="meta">
Status: ${ticket.status} · Priority: ${ticket.priority}<br>
Department: ${escapeHtml(dept?.name ?? '—')} · Topic: ${escapeHtml(topic?.name ?? '—')}<br>
User: ${escapeHtml(owner?.name ?? '—')} &lt;${escapeHtml(owner?.email ?? '')}&gt;<br>
Assignee: ${escapeHtml(assignee?.name ?? 'Unassigned')} · Created: ${formatDate(ticket.createdAt)}
</div>
${messages
  .map(
    (m) => `<article class="msg${m.internal ? ' internal' : ''}">
<h3>${escapeHtml(m.authorName)} <span style="font-weight:normal;color:#666">(${m.kind}${m.internal ? ', internal' : ''})</span></h3>
<time>${formatDate(m.createdAt)}</time>
<div>${escapeHtml(m.body).replace(/\n/g, '<br>')}</div>
${m.attachments?.length ? `<p><small>Attachments: ${m.attachments.map(escapeHtml).join(', ')}</small></p>` : ''}
</article>`,
  )
  .join('')}
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}</script>
</body></html>`
  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
