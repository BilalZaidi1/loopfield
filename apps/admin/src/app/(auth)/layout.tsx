import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { env, ENV_LABEL } from '@/lib/env';
import { Badge } from '@/components/ui';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Brand />
          {env.appEnv !== 'production' ? <Badge label={ENV_LABEL[env.appEnv]} tone="warning" /> : null}
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 flex flex-col gap-4">{children}</div>
        <p className="type-caption text-muted text-center">Staff only. Every action is recorded with your name and reason.</p>
      </div>
    </main>
  );
}
