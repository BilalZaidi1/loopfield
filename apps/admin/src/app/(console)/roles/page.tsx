import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { getRbac } from '@/lib/data';
import { relativeTime } from '@/lib/format';
import { ActionButton } from '@/components/client';
import { Badge, Banner, Card, cx, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import { RoleEditor } from './role-editor';
import { deleteRole, saveRole } from './actions';

export const metadata: Metadata = { title: 'Roles and permissions' };

export default async function RolesPage() {
  await requireStaff();
  const rbac = await getRbac();
  const areas = [...new Set(rbac.permissions.map((p) => p.area))];
  return (
    <>
      <PageHeader
        title="Roles and permissions"
        description="Access is given through permissions; roles bundle them. Every check also runs in the database, so the app’s operator screens follow the same rules. Admin always has everything."
        actions={rbac.can_edit ? <RoleEditor permissions={rbac.permissions} save={saveRole} /> : undefined}
      />
      {!rbac.can_edit ? <Banner tone="info" text="Only admins can change roles. You can see what each role allows." /> : null}

      <section className="grid grid-cols-12 gap-4" aria-label="Roles">
        {rbac.roles.map((r) => (
          <Card key={r.key} className="col-span-12 sm:col-span-6 xl:col-span-3 h-full">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1 min-w-0">
                <h2 className="type-heading truncate">{r.label}</h2>
                <code className="type-caption text-muted font-mono">{r.key}</code>
              </div>
              {r.key === 'admin' ? <Badge label="All" tone="title" /> : r.is_system ? <Badge label="Built-in" tone="muted" /> : <Badge label="Custom" tone="violet" />}
            </div>
            <p className="type-caption text-muted">{r.description || 'No description.'}</p>
            <div className="flex flex-wrap gap-1.5">
              {(r.key === 'admin' ? [] : r.permissions).map((p) => <Badge key={p} label={rbac.permissions.find((x) => x.key === p)?.label ?? p} tone="info" />)}
              {r.key === 'admin' ? <span className="type-caption text-muted">Every permission, including ones added later.</span> : null}
              {r.key !== 'admin' && !r.permissions.length ? <span className="type-caption text-muted">No permissions yet.</span> : null}
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
              <Link href="/staff" className="type-label text-primary inline-flex items-center gap-1"><Icon name="users" size={15} /> {r.members} {r.members === 1 ? 'member' : 'members'}</Link>
              {rbac.can_edit && r.key !== 'admin' ? (
                <div className="flex gap-2">
                  <RoleEditor role={r} permissions={rbac.permissions} save={saveRole} />
                  {!r.is_system ? (
                    <ActionButton label="Delete" size="sm" variant="ghost" icon="trash" title={`Delete the ${r.label} role?`}
                      description={r.members ? 'Remove it from its members on Staff first.' : 'Nobody has this role. Deleting it cannot be undone.'}
                      disabled={r.members > 0} action={deleteRole.bind(null, r.key)} />
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>
        ))}
      </section>

      <Card title="Who can do what" padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left min-w-[760px]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="type-caption text-subtle font-semibold py-3 pl-5 pr-4 sticky left-0 bg-surface">Permission</th>
                {rbac.roles.map((r) => <th key={r.key} scope="col" className="type-caption text-subtle font-semibold py-3 px-2 text-center whitespace-nowrap">{r.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {areas.map((area) => (
                <AreaRows key={area} area={area} rbac={rbac} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="type-caption text-muted px-5 pb-5">Updated {relativeTime(rbac.roles.map((r) => r.updated_at).sort().at(-1))}.</p>
      </Card>
    </>
  );
}

function AreaRows({ area, rbac }: { area: string; rbac: Awaited<ReturnType<typeof getRbac>> }) {
  const perms = rbac.permissions.filter((p) => p.area === area);
  return (
    <>
      <tr><th colSpan={rbac.roles.length + 1} scope="colgroup" className="type-micro uppercase tracking-[0.08em] text-subtle pt-4 pb-1 pl-5 sticky left-0 bg-surface">{area}</th></tr>
      {perms.map((p) => (
        <tr key={p.key} className="border-b border-line last:border-b-0">
          <th scope="row" className="py-2.5 pl-5 pr-4 font-normal sticky left-0 bg-surface">
            <div className="type-body-strong">{p.label}</div>
            <div className="type-caption text-muted max-w-[320px]">{p.help}</div>
          </th>
          {rbac.roles.map((r) => {
            const on = r.permissions.includes(p.key);
            return (
              <td key={r.key} className="text-center px-2">
                <span className={cx('inline-flex h-7 w-7 items-center justify-center rounded-full', on ? 'bg-success-soft text-success' : 'text-subtle')}
                  aria-label={on ? `${r.label} has ${p.label}` : `${r.label} does not have ${p.label}`} role="img">
                  {on ? <Icon name="check" size={16} strokeWidth={2.5} /> : '–'}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
