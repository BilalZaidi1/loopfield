import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="type-title">Not found</h1>
      <p className="type-body text-muted">This item does not exist or was already resolved.</p>
      <Link href="/overview" className="type-label text-primary">Back to overview</Link>
    </main>
  );
}
