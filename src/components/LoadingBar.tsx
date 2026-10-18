interface Props {
  progress: { done: number; total: number; phase: string } | null;
}

export function LoadingBar({ progress }: Props) {
  if (!progress || progress.total === 0) return null;

  const pct = Math.round((progress.done / progress.total) * 100);

  return (
    <div className="loading-bar">
      <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
      <span className="loading-bar-text">
        {progress.phase}: {progress.done}/{progress.total}
      </span>
    </div>
  );
}
