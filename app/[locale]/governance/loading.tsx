function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-[var(--swap-container-border)] ${className}`} />;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-4 py-4">
      <SkeletonLine className="h-5 w-40" />
      <div className="mt-4 space-y-3">
        <SkeletonLine className="h-4 w-3/4" />
        <SkeletonLine className="h-4 w-2/3" />
        <SkeletonLine className="h-4 w-1/2" />
      </div>
    </div>
  );
}

export default function GovernanceLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background font-sans">
      <div className="mx-auto flex w-full max-w-6xl flex-col p-3">
        <section className="mt-4 flex w-full max-w-6xl items-center justify-between pt-4 text-[var(--text-input)]">
          <div className="w-full">
            <SkeletonLine className="h-9 w-64" />
            <SkeletonLine className="mt-3 hidden h-4 w-96 md:block" />
          </div>
        </section>

        <nav className="mt-5 flex items-center gap-2 overflow-x-auto rounded-full border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonLine key={index} className="h-9 w-36 shrink-0" />
          ))}
        </nav>

        <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </section>

        <section className="mt-4 rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-4 py-4">
          <SkeletonLine className="h-6 w-32" />
          <div className="mt-3 grid grid-cols-1 gap-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </div>
    </div>
  );
}
