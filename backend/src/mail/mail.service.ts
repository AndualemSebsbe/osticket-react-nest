import { Inject, Injectable } from '@nestjs/common';
import tls from 'node:tls';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SyslogLogTypeEnum } from '@prisma/client';

type Attachment = { name: string; type: string; data: Buffer };
type MailInput = { to: string | string[]; subject: string; text: string; attachments?: Attachment[]; from?: string; ticketNumber?: string };

class SmtpSession {
  private buffer = ''; private pendingLines: string[] = [];
  private waiters: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  constructor(private readonly socket: tls.TLSSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => { this.buffer += chunk; this.flush(); });
    socket.on('error', (error) => { while (this.waiters.length) this.waiters.shift()!.reject(error); });
  }
  private flush() {
    const lines = this.buffer.split(/\r?\n/); this.buffer = lines.pop() || '';
    for (const line of lines) { this.pendingLines.push(line); if (/^\d{3} /.test(line)) { const reply = this.pendingLines.join('\n'); this.pendingLines = []; this.waiters.shift()?.resolve(reply); } }
  }
  read() { return new Promise<string>((resolve, reject) => this.waiters.push({ resolve, reject })); }
  async command(line: string, expected: number[]) {
    const waiting = this.read(); this.socket.write(line + '\r\n'); const reply = await waiting;
    if (!expected.includes(Number(reply.slice(0, 3)))) throw new Error('SMTP ' + line.split(' ')[0] + ' failed: ' + reply);
    return reply;
  }
}

@Injectable()
export class MailService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  isConfigured() { return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && (process.env.SMTP_FROM || process.env.SMTP_USER)); }
  private async open() {
    return new Promise<tls.TLSSocket>((resolve, reject) => {
      const host = process.env.SMTP_HOST || ''; const port = Number(process.env.SMTP_PORT || 465);
      const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => resolve(socket));
      socket.setTimeout(20000, () => socket.destroy(new Error('SMTP connection timed out.'))); socket.once('error', reject);
    });
  }
  async send(input: MailInput) {
    const from = input.from || process.env.SMTP_FROM || process.env.SMTP_USER || '';
    if (!this.isConfigured() || !from) throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM.');
    const recipients = [...new Set((Array.isArray(input.to) ? input.to : [input.to]).map(v => String(v || '').trim().toLowerCase()).filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))];
    if (!recipients.length) throw new Error('At least one valid email recipient is required.');
    const safeFrom = from.trim().replace(/[<>\r\n]/g, ''); const socket = await this.open(); const smtp = new SmtpSession(socket);
    try {
      const greeting = await smtp.read(); if (!greeting.startsWith('220')) throw new Error('SMTP greeting failed: ' + greeting);
      await smtp.command('EHLO osticket.local', [250]); await smtp.command('AUTH LOGIN', [334]);
      await smtp.command(Buffer.from(process.env.SMTP_USER || '').toString('base64'), [334]); await smtp.command(Buffer.from(process.env.SMTP_PASS || '').toString('base64'), [235]);
      await smtp.command('MAIL FROM:<' + safeFrom + '>', [250]);
      for (const to of recipients) await smtp.command('RCPT TO:<' + to + '>', [250, 251]);
      await smtp.command('DATA', [354]);
      const subject = '=?UTF-8?B?' + Buffer.from(input.subject).toString('base64') + '?=';
      const headers = 'From: ' + safeFrom + '\r\nTo: ' + recipients.join(', ') + '\r\nSubject: ' + subject + '\r\nMIME-Version: 1.0\r\n';
      let content: string; const files = input.attachments || [];
      if (files.length) {
        const boundary = 'osticket-' + randomBytes(18).toString('hex');
        content = headers + 'Content-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + input.text.replace(/\r?\n/g, '\r\n') + '\r\n';
        for (const file of files) { const name = file.name.replace(/["\\\r\n]/g, '_'); const data = file.data.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd(); content += '--' + boundary + '\r\nContent-Type: ' + file.type + '; name="' + name + '"\r\nContent-Disposition: attachment; filename="' + name + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + data + '\r\n'; }
        content += '--' + boundary + '--\r\n';
      } else content = headers + 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + input.text.replace(/\r?\n/g, '\r\n') + '\r\n';
      const done = smtp.read(); socket.write(content.replace(/^\./gm, '..') + '.\r\n'); const accepted = await done;
      if (!accepted.startsWith('250')) throw new Error('SMTP message was not accepted: ' + accepted);
      await smtp.command('QUIT', [221]);
    } finally { socket.end(); }
  }

  async sendNotice(to: string | string[], subject: string, text: string, ticketNumber?: string, attachments: Attachment[] = [], from?: string, collaborators: Array<{ name: string; email: string; active: boolean }> = []) {
    const recipients = Array.isArray(to) ? to : [to];
    const rendered = text.replace(/%\{ticket\.recipients\}/g, collaborators.filter(p => p.active).map(p => p.name + ' <' + p.email + '>').join(', '));
    const message = { id: randomUUID(), at: new Date().toISOString(), to: recipients, from: from || process.env.SMTP_FROM || process.env.SMTP_USER || '', subject, ticketNumber };
    try {
      await this.send({ to: recipients, subject, text: rendered, attachments, from });
      await this.prisma.syslog.create({ data: { log_type: SyslogLogTypeEnum.DEBUG, title: 'Outgoing email: ' + subject, log: JSON.stringify({ ...message, status: 'sent' }), logger: 'osticket-react-mail', ip_address: '127.0.0.1', created: new Date(), updated: new Date() } });
      return { ...message, status: 'sent' };
    } catch (error) {
      const failed = { ...message, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      await this.prisma.syslog.create({ data: { log_type: SyslogLogTypeEnum.ERROR, title: 'Outgoing email: ' + subject, log: JSON.stringify(failed), logger: 'osticket-react-mail', ip_address: '127.0.0.1', created: new Date(), updated: new Date() } });
      return failed;
    }
  }

  async listLog() {
    const rows = await this.prisma.syslog.findMany({ where: { logger: 'osticket-react-mail' }, orderBy: { created: 'desc' }, take: 500 });
    return rows.map(row => { try { return JSON.parse(row.log); } catch { return { id: String(row.log_id), at: row.created.toISOString(), to: '', subject: row.log, status: 'unknown' }; } });
  }
}
