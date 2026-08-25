type Props = {
  active: boolean;
  label?: string | null;
};

/** Full-screen busy overlay with indeterminate progress bar. */
export function BusyOverlay({ active, label }: Props) {
  if (!active) {
    return null;
  }

  return (
    <div className="busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="busy-card">
        <div className="busy-spinner" aria-hidden="true" />
        <p className="busy-label">{label?.trim() || "Chargement…"}</p>
        <div className="busy-track" aria-hidden="true">
          <div className="busy-bar" />
        </div>
      </div>
    </div>
  );
}

/** Let React paint loading UI before a long await. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
