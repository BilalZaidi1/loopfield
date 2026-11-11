import { requireKeys, type ServerEnv } from './env.ts';

/**
 * Transactional email through Resend's HTTP API (server-side only). Retries transient failures with
 * backoff and uses an Idempotency-Key so a retried job cannot send twice. Every email is branded,
 * readable on a phone and in dark mode, and carries no health readings, routes, precise places or
 * message text.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: string;
  idempotencyKey: string;
  /** Extra headers, e.g. one-click unsubscribe (RFC 8058). */
  headers?: Record<string, string>;
}

/** A send Resend refused. `retryable` is false for problems another attempt cannot fix (bad address, unverified domain). */
export class EmailSendError extends Error {
  override name = 'EmailSendError';
  constructor(readonly status: number, readonly retryable: boolean) {
    super(`email send failed: resend ${status}`);
  }
}

export async function sendEmail(env: ServerEnv, msg: EmailMessage, fetchImpl: typeof fetch = fetch): Promise<{ id: string }> {
  const cfg = requireKeys(env, ['RESEND_API_KEY', 'RESEND_FROM']);
  let status = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': msg.idempotencyKey
      },
      body: JSON.stringify({
        from: cfg.RESEND_FROM,
        to: [msg.to],
        ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {}),
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        tags: [{ name: 'category', value: msg.tag }],
        ...(msg.headers ? { headers: msg.headers } : {})
      })
    });
    if (res.ok) return (await res.json()) as { id: string };
    status = res.status;
    if (res.status < 500 && res.status !== 429) throw new EmailSendError(res.status, false);
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw new EmailSendError(status, true);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---- Layout ---------------------------------------------------------------------------------------
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const C = { bg: '#EEF0F5', card: '#FFFFFF', ink: '#121318', muted: '#5D6170', soft: '#F3F4F8', violet: '#5B57E3', orange: '#FF7A1A', blue: '#0A74E0' };
const type = (size: number, line: number, weight: number, italic = false) =>
  `font-family:${FONT};font-size:${size}px;line-height:${line}px;font-weight:${weight};${italic ? 'font-style:italic;' : ''}`;

export type EmailAccent = 'violet' | 'orange' | 'blue';

export interface EmailParts {
  appName: string;
  /** Inbox preview line. */
  preheader: string;
  accent: EmailAccent;
  title: string;
  /** Paragraphs of plain text (escaped here). */
  paragraphs: string[];
  stats?: { label: string; value: string }[];
  cta?: { label: string; url: string };
  /** Why this email arrived; plain text. */
  reason: string;
  /** Settings link and, for optional email, a one-click unsubscribe link for this category. */
  manage?: { settingsUrl: string; unsubscribeUrl?: string; categoryLabel?: string };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function statGrid(stats: { label: string; value: string }[]): string {
  const cells = stats.map((s) =>
    `<td class="stat" width="50%" valign="top" style="padding:4px"><div class="statcell" style="background:${C.soft};border-radius:14px;padding:14px 16px">` +
    `<div class="ink" style="${type(26, 30, 900, true)}color:${C.ink};letter-spacing:-0.5px">${esc(s.value)}</div>` +
    `<div class="muted" style="${type(13, 18, 600)}color:${C.muted};padding-top:2px">${esc(s.label)}</div></div></td>`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td class="stat" width="50%" style="padding:4px"></td>'}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;margin-left:-4px;margin-right:-4px">${rows.join('')}</table>`;
}

export function renderEmail(subject: string, e: EmailParts): RenderedEmail {
  const accent = C[e.accent];
  const body = e.paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('');
  const cta = e.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td style="border-radius:12px;background:${C.violet}">` +
      `<a href="${esc(e.cta.url)}" style="display:inline-block;padding:14px 22px;${type(16, 20, 700)}color:#FFFFFF;text-decoration:none;border-radius:12px">${esc(e.cta.label)}</a></td></tr></table>`
    : '';
  const manage = e.manage
    ? ` <a href="${esc(e.manage.settingsUrl)}" style="color:${C.violet}">Email settings</a>` +
      (e.manage.unsubscribeUrl ? ` · <a href="${esc(e.manage.unsubscribeUrl)}" style="color:${C.violet}">Stop ${esc(e.manage.categoryLabel ?? 'these')} emails</a>` : '')
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
@media (max-width:600px){.card{padding:24px 20px!important}.title{font-size:24px!important;line-height:30px!important}.stat{display:block!important;width:100%!important}}
@media (prefers-color-scheme:dark){body,.bg{background:#101114!important}.card{background:#1A1B20!important}.ink{color:#F5F6FA!important}.muted{color:#A9ADBA!important}.statcell{background:#24262D!important}.mark,.muted a{color:#8B87FF!important}}
</style></head>
<body class="bg" style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td class="mark" style="padding:0 8px 14px;${type(24, 28, 900, true)}color:${C.violet};letter-spacing:-0.6px">${esc(e.appName)}</td></tr>
<tr><td class="card" style="background:${C.card};border-radius:20px;padding:32px;border-top:6px solid ${accent}">
<h1 class="title ink" style="margin:0;${type(28, 34, 800)}color:${C.ink};letter-spacing:-0.4px">${esc(e.title)}</h1>
<div class="ink" style="margin-top:14px;${type(16, 24, 500)}color:${C.ink}">${body}</div>
${e.stats?.length ? statGrid(e.stats) : ''}${cta}
</td></tr>
<tr><td class="muted" style="padding:18px 8px 0;${type(12, 18, 500)}color:${C.muted}">${esc(e.reason)}${manage}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    e.title,
    '',
    ...e.paragraphs.flatMap((p) => [p, '']),
    ...(e.stats?.length ? [...e.stats.map((s) => `${s.label}: ${s.value}`), ''] : []),
    ...(e.cta ? [`${e.cta.label}: ${e.cta.url}`, ''] : []),
    '—',
    e.reason,
    ...(e.manage ? [`Email settings: ${e.manage.settingsUrl}`] : []),
    ...(e.manage?.unsubscribeUrl ? [`Stop ${e.manage.categoryLabel ?? 'these'} emails: ${e.manage.unsubscribeUrl}`] : [])
  ].join('\n');
  return { subject, html, text };
}

const SECURITY_REASON = 'This is an account security email. It is sent even when other emails are turned off.';

// ---- Auth and security email (Supabase Send Email Hook) -------------------------------------------
export type AuthEmailAction =
  | 'signup'
  | 'recovery'
  | 'magiclink'
  | 'email'
  | 'email_change'
  | 'email_change_new'
  | 'invite'
  | 'reauthentication'
  | 'password_changed_notification'
  | 'email_changed_notification'
  | 'phone_changed_notification'
  | 'identity_linked_notification'
  | 'identity_unlinked_notification'
  | 'mfa_factor_enrolled_notification'
  | 'mfa_factor_unenrolled_notification';

export const AUTH_NOTIFICATION_ACTIONS: AuthEmailAction[] = [
  'password_changed_notification',
  'email_changed_notification',
  'phone_changed_notification',
  'identity_linked_notification',
  'identity_unlinked_notification',
  'mfa_factor_enrolled_notification',
  'mfa_factor_unenrolled_notification'
];

export const isAuthEmailAction = (a: string): a is AuthEmailAction =>
  ['signup', 'recovery', 'magiclink', 'email', 'email_change', 'email_change_new', 'invite', 'reauthentication', ...AUTH_NOTIFICATION_ACTIONS].includes(a);

const NOT_YOU = 'If this was not you, reset your password from the sign-in screen straight away, then tell us through Help in the app.';

/** Templates for the Supabase Send Email Hook (single delivery path for auth email). */
export function authEmail(
  appName: string,
  action: AuthEmailAction,
  opts: { url: string | null; token: string; oldEmail?: string; newEmail?: string; provider?: string; factorType?: string }
): RenderedEmail {
  const codeLine = opts.token ? `Or enter this code in the app: ${opts.token}` : '';
  const withCode = (sentence: string, label: string, subject: string, preheader: string): RenderedEmail =>
    renderEmail(`${subject} — ${appName}`, {
      appName, preheader, accent: 'violet', title: subject,
      paragraphs: [sentence, ...(opts.url ? [codeLine] : [`Your code: ${opts.token}`]), 'The link and code expire soon and work once. Never share them; we will never ask you for them.'],
      cta: opts.url && label ? { label, url: opts.url } : undefined,
      reason: SECURITY_REASON
    });
  const notice = (subject: string, sentence: string): RenderedEmail =>
    renderEmail(`${subject} — ${appName}`, { appName, preheader: sentence, accent: 'orange', title: subject, paragraphs: [sentence, NOT_YOU], reason: SECURITY_REASON });
  switch (action) {
    case 'signup':
      return withCode(`Confirm your email address to finish creating your ${appName} account.`, 'Confirm email', 'Confirm your email', 'One tap to finish signing up.');
    case 'recovery':
      return withCode('Use the button below to choose a new password.', 'Reset password', 'Reset your password', 'Choose a new password.');
    case 'magiclink':
    case 'email':
      return withCode(`Use the button below to sign in to ${appName}.`, 'Sign in', 'Your sign-in link', 'Your one-time sign-in link.');
    case 'email_change':
      return withCode('Confirm that you want to change the email address on your account.', 'Confirm change', 'Confirm your email change', 'Confirm the change to your account email.');
    case 'email_change_new':
      return withCode('Confirm this address for your account.', 'Confirm email', 'Confirm your new email', 'Confirm your new account email.');
    case 'invite':
      return withCode(`You have been invited to create a ${appName} account.`, 'Accept invitation', 'You have been invited', 'Create your account.');
    case 'reauthentication':
      return renderEmail(`Confirm it is you — ${appName}`, {
        appName, preheader: 'Your verification code.', accent: 'violet', title: 'Confirm it is you',
        paragraphs: ['Enter this code in the app to continue.', `Your code: ${opts.token}`, 'Never share this code; we will never ask you for it.'], reason: SECURITY_REASON
      });
    case 'password_changed_notification':
      return notice('Your password was changed', `The password for your ${appName} account was just changed.`);
    case 'email_changed_notification':
      return notice('Your email address was changed', `The email address on your ${appName} account was changed${opts.oldEmail && opts.newEmail ? ` from ${opts.oldEmail} to ${opts.newEmail}` : ''}.`);
    case 'phone_changed_notification':
      return notice('Your phone number was changed', `The phone number on your ${appName} account was changed.`);
    case 'identity_linked_notification':
      return notice('A sign-in method was added', `${opts.provider ? `${providerName(opts.provider)} sign-in` : 'A new sign-in method'} was linked to your ${appName} account.`);
    case 'identity_unlinked_notification':
      return notice('A sign-in method was removed', `${opts.provider ? `${providerName(opts.provider)} sign-in` : 'A sign-in method'} was removed from your ${appName} account.`);
    case 'mfa_factor_enrolled_notification':
      return notice('A verification method was added', `A new ${opts.factorType ? `${opts.factorType.toUpperCase()} ` : ''}verification method was added to your ${appName} account.`);
    case 'mfa_factor_unenrolled_notification':
      return notice('A verification method was removed', `A ${opts.factorType ? `${opts.factorType.toUpperCase()} ` : ''}verification method was removed from your ${appName} account.`);
  }
}

const providerName = (p: string) => ({ apple: 'Apple', google: 'Google', email: 'Email and password' })[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

// ---- Account email ----------------------------------------------------------------------------------
export function exportReadyEmail(appName: string, url: string): RenderedEmail {
  return renderEmail(`Your data export is ready — ${appName}`, {
    appName, preheader: 'Download it from the app within 72 hours.', accent: 'violet', title: 'Your data export is ready',
    paragraphs: ['Open the app to download your export. The download link inside the app expires after 72 hours.'],
    cta: { label: 'Open the app', url }, reason: SECURITY_REASON
  });
}

export function accountDeletedEmail(appName: string): RenderedEmail {
  return renderEmail(`Your account was deleted — ${appName}`, {
    appName, preheader: 'Your account and its data are gone.', accent: 'orange', title: 'Your account was deleted',
    paragraphs: [
      'Your account and associated data have been deleted as requested.',
      'Data the app kept on your phone was cleared when you signed out or removed the app. Records in Apple Health or Health Connect are not deleted by us.'
    ],
    reason: 'This is the last email you will get from us.'
  });
}

/** Invitation sent to an email address (the person may not have an account yet). */
export function clubInvitationEmail(appName: string, clubName: string, inviter: string, url: string, kind: 'community' | 'group' = 'community'): RenderedEmail {
  const subject = `${inviter} invited you to ${clubName}`;
  return renderEmail(`${subject} — ${appName}`, {
    appName, preheader: `Join the ${kind} on ${appName}.`, accent: 'violet', title: subject,
    paragraphs: [`${inviter} invited you to join the ${kind} ${clubName} on ${appName}. Joining is optional and you can leave at any time.`, 'The invitation link expires. Ignore this email if you are not interested.'],
    cta: { label: 'View invitation', url },
    reason: `Someone typed this address into an invitation on ${appName}. We do not keep it unless you join.`
  });
}

// ---- Notification email -------------------------------------------------------------------------------
export interface EmailLinks {
  /** Where the button goes (the web version of the app). */
  open: string;
  settings: string;
  /** One-click unsubscribe for this category (absent for account email). */
  unsubscribe?: string;
}

const CATEGORY_LABEL = { runs: 'run summary', territory: 'daily land', clubs: 'community and group', events: 'event' } as const;
type OptionalCategory = keyof typeof CATEGORY_LABEL;
const manage = (links: EmailLinks, category: OptionalCategory) => ({ settingsUrl: links.settings, unsubscribeUrl: links.unsubscribe, categoryLabel: CATEGORY_LABEL[category] });

export type Units = 'metric' | 'imperial';
export const fmtDistance = (m: number, units: Units) => (units === 'imperial' ? `${(m / 1609.344).toFixed(2)} mi` : `${(m / 1000).toFixed(2)} km`);
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export function fmtPace(secPerKm: number, units: Units): string {
  const s = Math.round(units === 'imperial' ? secPerKm * 1.609344 : secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /${units === 'imperial' ? 'mi' : 'km'}`;
}
export function fmtArea(m2: number, units: Units): string {
  if (units === 'imperial') return m2 >= 258_999 ? `${(m2 / 2_589_988).toFixed(2)} sq mi` : `${Math.round(m2 / 4046.86 * 10) / 10} acres`;
  return m2 >= 1_000_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : m2 >= 10_000 ? `${(m2 / 10_000).toFixed(1)} ha` : `${Math.round(m2)} m²`;
}
export const fmtWhen = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

export function welcomeEmail(appName: string, links: EmailLinks): RenderedEmail {
  return renderEmail(`Welcome to ${appName}`, {
    appName, preheader: 'Run a loop, claim the land inside it.', accent: 'violet', title: `Welcome to ${appName}`,
    paragraphs: [
      'Every run counts towards your distance, badges and the places you have explored.',
      'Close a loop and the land inside it becomes yours on the all-time map, until another runner takes it. Season races start fresh every few weeks, and events and community challenges have their own standings.',
      'You choose who sees your runs. Your first and last 200 m are never shown on shared maps, and you can compete privately or not at all.'
    ],
    cta: { label: `Open ${appName}`, url: links.open },
    reason: `You are getting this because you created a ${appName} account. It is sent once.`,
    manage: { settingsUrl: links.settings }
  });
}

export function runSummaryEmail(appName: string, d: { date: string; distanceM: number; elapsedMs: number; paceSecPerKm: number | null; units: Units;
  land: { cells: number; taken: number; areaM2: number | null } | null; links: EmailLinks }): RenderedEmail {
  const stats = [
    { label: 'Distance', value: fmtDistance(d.distanceM, d.units) },
    { label: 'Time', value: fmtDuration(d.elapsedMs) },
    ...(d.paceSecPerKm ? [{ label: 'Average pace', value: fmtPace(d.paceSecPerKm, d.units) }] : []),
    ...(d.land?.cells ? [{ label: d.land.taken ? `Land captured (${d.land.taken} from others)` : 'Land captured', value: d.land.areaM2 ? fmtArea(d.land.areaM2, d.units) : `${d.land.cells} cells` }] : [])
  ];
  return renderEmail(`Your run on ${d.date} — ${appName}`, {
    appName, preheader: `${fmtDistance(d.distanceM, d.units)} in ${fmtDuration(d.elapsedMs)}.`, accent: 'blue', title: 'Your run is saved',
    paragraphs: [d.land?.cells ? 'Your loop was checked and its land is on the map.' : 'Here is your run. Close a loop next time to claim the land inside it.'],
    stats, cta: { label: 'See the run', url: d.links.open },
    reason: 'You turned on run summary emails.', manage: manage(d.links, 'runs')
  });
}

export function territoryDailyEmail(appName: string, d: { gained: number; lost: number; links: EmailLinks }): RenderedEmail {
  const parts = [d.gained ? `you captured ${d.gained} cells` : null, d.lost ? `other runners took ${d.lost} of yours` : null].filter(Boolean);
  return renderEmail(`Your land today — ${appName}`, {
    appName, preheader: parts.join(' and ') || 'Your land changed today.', accent: 'orange', title: 'Your land today',
    paragraphs: [`Today ${parts.join(' and ') || 'your land changed'}.`, 'Land changes are shown after a delay and never say who is out running right now. Plan your next loop when it suits you.'],
    stats: [...(d.gained ? [{ label: 'Cells captured', value: String(d.gained) }] : []), ...(d.lost ? [{ label: 'Cells taken by others', value: String(d.lost) }] : [])],
    cta: { label: 'Open the map', url: d.links.open },
    reason: 'You turned on daily land emails. At most one arrives per day.', manage: manage(d.links, 'territory')
  });
}

export function clubInviteEmail(appName: string, d: { clubName: string; kind: 'community' | 'group'; inviter: string; links: EmailLinks }): RenderedEmail {
  const subject = `${d.inviter} invited you to ${d.clubName}`;
  return renderEmail(`${subject} — ${appName}`, {
    appName, preheader: `Join the ${d.kind} on ${appName}.`, accent: 'violet', title: subject,
    paragraphs: [`${d.inviter} invited you to the ${d.kind} ${d.clubName}.`, d.kind === 'group' ? 'Groups are private: only the people in it see its posts and chat.' : 'Joining is optional and you can leave at any time.'],
    cta: { label: 'See the invitation', url: d.links.open },
    reason: 'You get invitation emails because community and group emails are on.', manage: manage(d.links, 'clubs')
  });
}

export function clubApprovedEmail(appName: string, d: { clubName: string; kind: 'community' | 'group'; links: EmailLinks }): RenderedEmail {
  return renderEmail(`You are in: ${d.clubName} — ${appName}`, {
    appName, preheader: 'Your request to join was approved.', accent: 'violet', title: `You are in ${d.clubName}`,
    paragraphs: [`An admin approved your request to join the ${d.kind}. Its posts, members' race and challenges are open to you now.`],
    cta: { label: `Open the ${d.kind}`, url: d.links.open },
    reason: 'You asked to join this community.', manage: manage(d.links, 'clubs')
  });
}

export function clubOwnershipEmail(appName: string, d: { clubName: string; kind: 'community' | 'group'; from: string; links: EmailLinks }): RenderedEmail {
  return renderEmail(`${d.from} asked you to take over ${d.clubName} — ${appName}`, {
    appName, preheader: 'Accept or decline in the app.', accent: 'violet', title: `Take over ${d.clubName}?`,
    paragraphs: [`${d.from} offered you ownership of the ${d.kind}. Nothing changes until you accept; ${d.from} would stay on as an admin.`, 'The offer expires after 7 days.'],
    cta: { label: 'Accept or decline', url: d.links.open },
    reason: 'The owner chose you.', manage: manage(d.links, 'clubs')
  });
}

export function clubClosedEmail(appName: string, d: { clubName: string; kind: 'community' | 'group'; links: EmailLinks }): RenderedEmail {
  return renderEmail(`${d.clubName} was deleted — ${appName}`, {
    appName, preheader: `The ${d.kind} no longer exists.`, accent: 'orange', title: `${d.clubName} was deleted`,
    paragraphs: [`The owner deleted the ${d.kind}. Its posts, members' race and running challenges are gone. Your runs, your land on the all-time map and your posts elsewhere are not affected.`],
    reason: 'You were a member.', manage: manage(d.links, 'clubs')
  });
}

export function eventRegisteredEmail(appName: string, d: { name: string; startsAt: string; endsAt: string; timeZone: string; scoring: string; clubName: string | null; links: EmailLinks }): RenderedEmail {
  const started = new Date(d.startsAt).getTime() <= Date.now();
  return renderEmail(`You joined ${d.name} — ${appName}`, {
    appName, preheader: started ? `It is on until ${fmtWhen(d.endsAt, d.timeZone)}.` : `It starts ${fmtWhen(d.startsAt, d.timeZone)}.`, accent: 'orange', title: `You are in: ${d.name}`,
    paragraphs: [
      `${d.scoring}${d.clubName ? ` You run for ${d.clubName}.` : ''}`,
      started ? `It is on now and ends ${fmtWhen(d.endsAt, d.timeZone)}.` : `It runs from ${fmtWhen(d.startsAt, d.timeZone)} to ${fmtWhen(d.endsAt, d.timeZone)}. We will remind you the day before.`,
      'Runs only count while the event is on. You can leave it at any time.'
    ],
    cta: { label: 'See the event', url: d.links.open },
    reason: 'You joined this event.', manage: manage(d.links, 'events')
  });
}

export function eventReminderEmail(appName: string, d: { name: string; startsAt: string; timeZone: string; links: EmailLinks }): RenderedEmail {
  return renderEmail(`${d.name} starts soon — ${appName}`, {
    appName, preheader: `Starts ${fmtWhen(d.startsAt, d.timeZone)}.`, accent: 'orange', title: `${d.name} starts soon`,
    paragraphs: [`The event you joined starts ${fmtWhen(d.startsAt, d.timeZone)}. Runs count from then until it ends.`, 'Run where it is safe and legal; enclosing an area never grants permission to enter it.'],
    cta: { label: 'See the event', url: d.links.open },
    reason: 'You joined this event.', manage: manage(d.links, 'events')
  });
}

export function eventResultsEmail(appName: string, d: { name: string; rank: number | null; clubRank: number | null; links: EmailLinks }): RenderedEmail {
  return renderEmail(`${d.name}: final results — ${appName}`, {
    appName, preheader: d.rank ? `You finished ${ordinal(d.rank)}.` : 'The final standings are in.', accent: 'orange', title: `${d.name} has finished`,
    paragraphs: [d.rank ? `You finished ${ordinal(d.rank)}${d.clubRank ? ` and your club finished ${ordinal(d.clubRank)}` : ''}.` : 'The final standings are in.'],
    stats: [...(d.rank ? [{ label: 'Your place', value: ordinal(d.rank) }] : []), ...(d.clubRank ? [{ label: 'Your club', value: ordinal(d.clubRank) }] : [])],
    cta: { label: 'See the standings', url: d.links.open },
    reason: 'You took part in this event.', manage: manage(d.links, 'events')
  });
}

export function seasonResultsEmail(appName: string, d: { name: string; season: number; rank: number; runners: number; areaM2: number; units: Units; links: EmailLinks }): RenderedEmail {
  return renderEmail(`Season ${d.season} results — ${appName}`, {
    appName, preheader: `You finished ${ordinal(d.rank)} of ${d.runners}.`, accent: 'orange', title: `Season ${d.season} has ended`,
    paragraphs: [`The ${d.name} season ${d.season} race is settled. You finished ${ordinal(d.rank)} of ${d.runners} runners. A new season has started fresh; your land on the all-time map stays.`],
    stats: [{ label: 'Your place', value: ordinal(d.rank) }, { label: 'Your land', value: fmtArea(d.areaM2, d.units) }],
    cta: { label: 'See the season', url: d.links.open },
    reason: 'You held land in this season race.', manage: manage(d.links, 'events')
  });
}

export const ensureConfigured = (env: ServerEnv) => requireKeys(env, ['RESEND_API_KEY', 'RESEND_FROM']);
