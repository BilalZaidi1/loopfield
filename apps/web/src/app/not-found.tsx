import Link from 'next/link';
import { LoopMark } from '@/components/LoopMark';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <LoopMark size={64} />
      <h1 className="t-display text-ink">Off the map.</h1>
      <p className="t-body max-w-[32ch] text-muted">This street isn’t on Loopfield. The rest of the city is.</p>
      <Link href="/" className="t-label rounded-full bg-primary-fill px-6 py-3.5 text-white">
        Back to the field
      </Link>
    </main>
  );
}
