/** The app's LoadingState. */
export default function Loading() {
  return (
    <div role="progressbar" aria-label="Loading" className="flex flex-col items-center justify-center gap-3 py-16">
      <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-line border-t-primary" />
      <span className="type-caption text-muted">Loading…</span>
    </div>
  );
}
