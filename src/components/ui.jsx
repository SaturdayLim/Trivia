/**
 * @file Shared primitives for the three role shells. Deliberately small — the
 * real design pass is S5 (Solutions suite, motion per V2-25). What is NOT
 * deferred, because it is an acceptance criterion rather than taste:
 *
 *   - Touch targets are ≥44px (PRD §6). `Button` and `TextInput` enforce it.
 *   - All copy is proper case with real spacing (v1 defect #6). No `SUDDEN_DEATH`.
 *   - Numeric inputs accept typing, not just arrows (v1 defect #9) — see
 *     `NumberField`, which is a text input with steppers bolted on, never a
 *     stepper pretending to be a field.
 *   - Dropdowns close on an explicit choice and on nothing else (v1 defect #7)
 *     — see `Select`. No blur-to-dismiss, no scroll-to-dismiss.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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

// ---------------------------------------------------------------------------
// Form controls for Stage setup (PRD §3.2 step 3)
// ---------------------------------------------------------------------------

/**
 * A number you can TYPE (v1 defect #9). The v1 control only moved on arrow
 * keys, so a Host setting a 45 second timer pressed Up fifteen times.
 *
 * The input is a text field, not `type="number"`: `inputMode="numeric"` raises
 * the phone keypad without inheriting the desktop spinner's key handling, and
 * nothing here calls `preventDefault` on a keystroke. While the field is being
 * edited it holds the raw string — an empty box mid-retype is a legal state —
 * and it commits a clamped integer on every parse and again on blur.
 *
 * @param {Object} props
 * @param {number} props.value
 * @param {(n: number) => void} props.onChange - receives clamped integers only.
 * @param {number} props.min
 * @param {number} props.max
 * @param {string} [props.label]
 * @param {string} [props.suffix] - e.g. "s" for seconds.
 */
export function NumberField({ value, onChange, min, max, label, ariaLabel, suffix, id, className = '' }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  const name = label || ariaLabel;

  // Follow the prop while the user isn't typing (Reset, or another Stage's
  // value scrolling into this control), but never yank the box out from under
  // a half-typed number.
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const clamp = (n) => Math.min(max, Math.max(min, Math.trunc(n)));

  function commit(raw) {
    const n = parseInt(String(raw).trim(), 10);
    if (Number.isFinite(n)) onChange(clamp(n));
  }

  function step(delta) {
    const next = clamp((Number.isFinite(value) ? value : min) + delta);
    setDraft(String(next));
    onChange(next);
  }

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm text-white/60">
          {label}
        </label>
      )}
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`Decrease ${name || 'value'}`}
          onClick={() => step(-1)}
          disabled={value <= min}
          className="size-11 shrink-0 rounded-xl border border-white/15 text-xl text-white/80 disabled:opacity-30"
        >
          −
        </button>
        <div className="relative flex-1">
          <input
            id={id}
            value={draft}
            inputMode="numeric"
            autoComplete="off"
            aria-label={name}
            onFocus={() => { focused.current = true; }}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, '');
              setDraft(raw);
              commit(raw);
            }}
            onBlur={() => {
              focused.current = false;
              const n = parseInt(draft, 10);
              const next = Number.isFinite(n) ? clamp(n) : value;
              setDraft(String(next));
              onChange(next);
            }}
            className="min-h-[44px] w-full rounded-xl border border-white/15 bg-black/40 px-4 text-center font-mono text-lg text-white outline-none focus:border-[var(--stack-accent)]"
          />
          {suffix && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/30">
              {suffix}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={`Increase ${name || 'value'}`}
          onClick={() => step(1)}
          disabled={value >= max}
          className="size-11 shrink-0 rounded-xl border border-white/15 text-xl text-white/80 disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Two or three mutually exclusive choices, all visible. Nothing to open, so
 * nothing can dismiss itself (v1 defect #7 by construction).
 * @param {Object} props
 * @param {Array<{value: string, label: string}>} props.options
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 */
export function Segmented({ options, value, onChange, label, className = '' }) {
  return (
    <div className={className}>
      {label && <span className="mb-1.5 block text-sm text-white/60">{label}</span>}
      <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl bg-black/40 p-1">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold transition ${
                active ? 'bg-[var(--stack-accent)] text-black' : 'text-white/60 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A dropdown that stays open until the user makes an explicit choice (v1 defect
 * #7 — "Order-recalculation dropdown auto-dismisses").
 *
 * The rule is enforced by what is NOT here: no `onBlur` handler, no
 * click-outside listener, no scroll or resize dismissal. The panel closes when
 * an option is pressed, when Cancel is pressed, or when Escape is pressed — all
 * three of which are the user saying so. A tap elsewhere on the page hits the
 * backdrop, which swallows it and leaves the list open.
 *
 * @param {Object} props
 * @param {Array<{value: string, label: string}>} props.options
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} props.label
 */
export function Select({ options, value, onChange, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const panel = useRef(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useLayoutEffect(() => {
    if (open && panel.current) panel.current.focus();
  }, [open]);

  return (
    <div className={className}>
      {label && <span className="mb-1.5 block text-sm text-white/60">{label}</span>}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-white/15 bg-black/40 px-4 text-left text-white"
      >
        <span>{current ? current.label : 'Choose'}</span>
        <span aria-hidden="true" className="text-white/40">
          ▾
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          {/* Backdrop: absorbs the stray tap that used to dismiss the list. */}
          <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
          <div
            ref={panel}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            className="relative w-full max-w-sm rounded-2xl border border-white/15 bg-[#14161c] p-2 outline-none"
          >
            <p className="px-3 py-2 text-sm text-white/40">{label}</p>
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-left ${
                  opt.value === value ? 'bg-white/10 font-semibold' : 'hover:bg-white/5'
                }`}
              >
                {opt.label}
                {opt.value === value && <span className="text-[var(--stack-accent)]">✓</span>}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-1 min-h-[44px] w-full rounded-xl text-sm text-white/50 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A bottom sheet for the peripherals (Scores, Question Log, Stage Settings).
 * Unlike `Select` this one is dismissible by its backdrop — a peripheral is a
 * glance, not a decision, and trapping a player inside the scoreboard mid-turn
 * would be its own defect.
 */
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-white/15 bg-[#14161c] sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-11 rounded-xl text-2xl leading-none text-white/50 hover:bg-white/5"
          >
            ×
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
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
