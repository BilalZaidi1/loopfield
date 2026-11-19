import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import type { SqlSaved, SqlView } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { SqlEditor } from './editor';
import { deleteQuery, runSql, saveQuery } from './actions';

export const metadata: Metadata = { title: 'SQL editor' };

export default async function SqlPage() {
  await requirePermission('sql');
  const [catalog, saved] = await Promise.all([rpc<SqlView[]>('ops_sql_catalog'), rpc<SqlSaved>('ops_sql_saved')]);
  return (
    <>
      <PageHeader title="SQL editor"
        description="Ask the data anything with read-only SQL. You see curated views of the tables: routes, places, notes, messages, health data, privacy zones and email addresses are left out. Use Supabase Studio for anything that has to write." />
      <SqlEditor catalog={catalog} saved={saved} run={runSql} save={saveQuery} remove={deleteQuery} />
    </>
  );
}
