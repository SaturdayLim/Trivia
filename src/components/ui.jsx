/**
 * @file Shared primitives for the three role shells. Deliberately small — the
 * real design pass is S5 (Solutions suite, motion per V2-25). What is NOT
 * deferred, because it is an acceptance criterion rather than taste:
 *
 *   - Touch targets are ≥44px (PRD §6). `Button` and `TextInput` enforce it.
 *   - All copy is proper case with real spacing (v1 defect #6). No `SUDDEN_DEATH`.
 *   - Numeric inputs accept typing, not just arrows (v1 defect #9) — see
 *     `TextInput`, which never intercepts keys.
 */

/** Full-bleed night canvas. `center` for entry/join screens, off for lobbies. */
export function Screen({ children, center = false, className = '' }) {
  return (
    <div
      className={`min-h-screen w-full text-white ${center ? 'flex flex-col items-center justify-center' : ''} ${className}`}
      style={{ background: 'var(--stack-bg)' }}
    >
      {children}
    </div>
  );
}

export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>{children}</div>
  );
}

const VARIANTS = {
  primary: 'bg-[var(--stack-accent)] text-black hover:brightness-110 disabled:brightness-75',
  secondary: 'bg-white/10 text-white hover:bg-white/15',
  danger: 'bg-red-500/90 text-white hover:bg-red-500',
  ghost: 'bg-transparent text-white/70 hover:text-white hover:bg-white/5',
};

export function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      // min-h-[44px]: PRD §6 touch target, not a style preference.
      className={`min-h-[44px] rounded-xl px-5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function TextInput({ label, hint, className = '', ...props }) {
  return (
    <label className="block w-full">
      {label && <span className="mb-1.5 block text-sm text-white/60">{label}</span>}
      <input
        className={`min-h-[44px] w-full rounded-xl border border-white/15 bg-black/40 px-4 text-white placeholder:text-white/30 outline-none focus:border-[var(--stack-accent)] ${className}`}
        {...props}
      />
      {hint && <span className="mt-1.5 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

/** The room code, rendered the way it gets read aloud across a room. */
export function RoomCode({ code, size = 'md' }) {
  const sizes = { md: 'text-3xl tracking-[0.35em]', lg: 'text-6xl tracking-[0.3em]', xl: 'text-8xl tracking-[0.25em]' };
  return (
    <span className={`font-mono font-bold text-[var(--stack-accent)] ${sizes[size]}`}>{code}</span>
  );
}

/** A live/asleep dot. Grey means "we still count you", never "you're gone". */
export function PresenceDot({ connected, className = '' }) {
  return (
    <span
      aria-label={connected ? 'Connected' : 'Away'}
      title={connected ? 'Connected' : 'Away'}
      className={`inline-block size-2 shrink-0 rounded-full ${connected ? 'bg-emerald-400' : 'bg-white/25'} ${className}`}
    />
  );
}

export function Banner({ tone = 'info', children }) {
  const tones = {
    info: 'border-white/15 bg-white/5 text-white/80',
    warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    error: 'border-red-400/30 bg-red-400/10 text-red-200',
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

/**
 * The connecting state. Not a dead placeholder (v1 defect #1): it is only ever
 * on screen for the length of one real network round trip, and it always
 * resolves into the live lobby or a named error with a retry.
 */
export function Connecting({ label = 'Joining the Game' }) {
  return (
    <Screen center>
      <div className="flex flex-col items-center gap-4">
        <div className="size-10 animate-spin rounded-full border-2 border-white/15 border-t-[var(--stack-accent)]" />
        <p className="text-white/60">{label}…</p>
      </div>
    </Screen>
  );
}

export function ErrorScreen({ title, detail, onRetry, onHome }) {
  return (
    <Screen center className="px-6">
      <Card className="max-w-md text-center">
        <h1 className="mb-2 text-2xl font-semibold">{title}</h1>
        {detail && <p className="mb-5 text-sm text-white/60">{detail}</p>}
        <div className="flex justify-center gap-3">
          {onRetry && <Button onClick={onRetry}>Try Again</Button>}
          {onHome && (
            <Button variant="secondary" onClick={onHome}>
              Back to Home
            </Button>
          )}
        </div>
      </Card>
    </Screen>
  );
}
