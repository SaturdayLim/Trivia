/**
 * @file The pieces every in-Game screen shares: the countdown, the Category and
 * difficulty grids, the option list, and the full-screen locked-in letter.
 *
 * All uniform-grid (v1 defect #2) and all proper-case (v1 defect #6). None of
 * them own game state — they take a value and an `onPick`, so the same tile is
 * a Player's button and a Display's read-only card depending on whether a
 * handler was passed.
 */

import { useEffect, useRef, useState } from 'react';
import { DIFFICULTIES, OPTION_LETTERS, difficulty, secondsLeft } from '../state/game.js';

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Animates a number toward `value` on change (V2-25's "score count-ups").
 * Skips straight to the target on mount and under reduced motion — this is
 * a presentation detail on top of `t.score`, never a second source of truth.
 */
function useCountUp(value, duration = 450) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || prefersReducedMotion()) {
      setShown(value);
      return undefined;
    }
    // `startTime` is set from the FIRST rAF timestamp, not a `performance.now()`
    // call made before scheduling it — the two are not guaranteed to share an
    // origin in every environment, and a mismatch there turns a 450ms ease into
    // a wildly wrong intermediate number. Deriving both ends of the interval
    // from the same clock sidesteps the whole question.
    let startTime = null;
    let frame;
    const tick = (now) => {
      if (startTime === null) startTime = now;
      const t = Math.min(1, Math.max(0, (now - startTime) / duration));
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
}

/**
 * The shared countdown. Every screen derives it from the same `deadline` on the
 * server clock, so the Display and thirty phones agree to within their clock
 * offset — nobody runs a local `setInterval(30)` and drifts.
 *
 * Renders nothing at all when the Stage has no timer, rather than a misleading
 * frozen "0".
 *
 * @param {Object} props
 * @param {number} props.deadline - epoch ms; 0 = untimed Stage.
 * @param {() => number} props.serverNow
 * @param {boolean} [props.running] - false once the question is sealed. V2-15:
 *   "a player's explicit lock-in drops timer to 0", so a sealed question reads
 *   zero rather than freezing wherever the clock happened to be.
 * @param {'sm'|'lg'} [props.size]
 */
export function Timer({ deadline, serverNow, running = true, size = 'sm' }) {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (!running || !deadline) return undefined;
    const id = setInterval(() => setNow(serverNow()), 200);
    return () => clearInterval(id);
  }, [running, deadline, serverNow]);

  if (!deadline) return null;
  const left = running ? secondsLeft(deadline, now) : 0;
  const urgent = left <= 5;
  const big = size === 'lg';

  return (
    <div
      role="timer"
      aria-label="Thinking Time remaining"
      className={`font-mono font-bold tabular-nums transition-colors duration-300 ${big ? 'text-7xl' : 'text-3xl'} ${
        urgent ? 'animate-stack-urgent text-red-400' : 'text-white'
      }`}
    >
      {left}
      <span className={`ml-1 font-sans font-normal text-white/40 ${big ? 'text-2xl' : 'text-sm'}`}>s</span>
    </div>
  );
}

/** The numbered-circle icon fallback (V2-8). Never a broken image. */
function CategoryIcon({ icon, n, big }) {
  if (icon) {
    return <img src={icon} alt="" aria-hidden="true" className={big ? 'size-16' : 'size-10'} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full border-2 border-white/25 font-mono font-bold text-white/60 ${
        big ? 'size-16 text-2xl' : 'size-10 text-base'
      }`}
    >
      {n}
    </span>
  );
}

/**
 * Uniform Category tiles (v1 defect #2: "Category tiles uneven"). Every tile is
 * the same cell of the same grid and the same fixed height, whatever the length
 * of its name or the presence of its icon.
 *
 * @param {Object} props
 * @param {Array<{slug: string, name: string, icon: ?string, n: number, badge?: string, disabled?: boolean}>} props.items
 * @param {(slug: string) => void} [props.onPick] - omit for a read-only grid.
 * @param {string[]} [props.selected]
 * @param {boolean} [props.disabled] - a write is in flight; the tiles stay
 *   buttons and go disabled, rather than becoming inert `div`s that a screen
 *   reader (or a test) can no longer find.
 * @param {'sm'|'lg'} [props.scale]
 */
export function CategoryGrid({ items, onPick, selected = [], disabled = false, scale = 'sm', columns }) {
  const big = scale === 'lg';
  const chosen = new Set(selected);
  const cols = columns || (big ? 'grid-cols-5' : 'grid-cols-2 sm:grid-cols-3');

  return (
    <div className={`grid gap-3 ${cols}`}>
      {items.map((item) => {
        const isChosen = chosen.has(item.slug);
        const off = disabled || item.disabled;
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={item.slug}
            {...(onPick
              ? {
                  type: 'button',
                  onClick: () => !off && onPick(item.slug),
                  disabled: off,
                  'aria-pressed': isChosen,
                }
              : {})}
            className={`flex ${big ? 'min-h-[168px]' : 'min-h-[132px]'} flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center transition duration-300 ${
              isChosen
                ? 'border-[var(--stack-accent)] bg-[var(--stack-accent)]/10'
                : 'border-white/10 bg-white/[0.03]'
            } ${item.disabled ? 'opacity-35' : onPick ? 'hover:border-white/30' : ''}`}
          >
            <CategoryIcon icon={item.icon} n={item.n} big={big} />
            <span className={`line-clamp-2 font-semibold ${big ? 'text-xl' : 'text-sm'}`}>{item.name}</span>
            {item.badge && (
              <span className={`text-white/40 ${big ? 'text-base' : 'text-xs'}`}>{item.badge}</span>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

/**
 * Easy / Medium / Hard, tinted per PRD §7 and labelled with what they are worth
 * this Stage (base × multiplier) and how many remain.
 * @param {Object} props
 * @param {{E: number, M: number, H: number}} props.counts
 * @param {(dif: string) => void} [props.onPick]
 * @param {number} props.multiplier
 * @param {boolean} [props.disabled] - see `CategoryGrid`.
 * @param {'sm'|'lg'} [props.scale]
 */
export function DifficultyGrid({ counts, onPick, multiplier = 1, disabled = false, scale = 'sm' }) {
  const big = scale === 'lg';
  return (
    <div className="grid grid-cols-3 gap-3">
      {DIFFICULTIES.map((d) => {
        const left = counts[d.value] || 0;
        const empty = left === 0;
        const off = disabled || empty;
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={d.value}
            {...(onPick ? { type: 'button', onClick: () => !off && onPick(d.value), disabled: off } : {})}
            className={`flex ${big ? 'min-h-[180px]' : 'min-h-[120px]'} flex-col items-center justify-center gap-1 rounded-2xl border-2 transition duration-300 ${
              empty ? 'opacity-30' : onPick ? 'hover:brightness-125' : ''
            }`}
            style={{ borderColor: d.tint, background: `${d.tint}14` }}
          >
            <span className={`font-bold ${big ? 'text-4xl' : 'text-xl'}`} style={{ color: d.tint }}>
              {d.label}
            </span>
            <span className={`font-semibold text-white ${big ? 'text-2xl' : 'text-sm'}`}>
              {d.points * multiplier} {d.points * multiplier === 1 ? 'Point' : 'Points'}
            </span>
            <span className={`text-white/40 ${big ? 'text-lg' : 'text-xs'}`}>
              {empty ? 'None Left' : `${left} Left`}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}

/**
 * The four options. After a reveal the correct one flashes green and a wrong
 * lock flashes red (PRD §3.2 step 5).
 *
 * @param {Object} props
 * @param {string[]} props.options
 * @param {?string} [props.selected] - this device's pending pick.
 * @param {?string|string[]} [props.locked] - committed answer(s): a single
 *   letter for one Team's own view (Player), or every currently-locked letter
 *   across Teams for a read-only view (Display, R1) — safe to show pre-reveal
 *   because a lock already zeroes the timer and locks everyone else (V2-15).
 * @param {?string} [props.correct] - set only once revealed.
 * @param {(letter: string) => void} [props.onPick]
 * @param {boolean} [props.disabled]
 * @param {'sm'|'lg'} [props.scale]
 */
export function Options({ options, selected, locked, correct, onPick, disabled, scale = 'sm' }) {
  const big = scale === 'lg';
  const revealed = Boolean(correct);
  const lockedLetters = new Set(Array.isArray(locked) ? locked : locked ? [locked] : []);

  return (
    <div className={`grid gap-3 ${big ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {(options || []).map((text, i) => {
        const letter = OPTION_LETTERS[i];
        const isCorrect = revealed && letter === correct;
        const isWrongLock = revealed && lockedLetters.has(letter) && letter !== correct;
        const isPicked = !revealed && (lockedLetters.has(letter) || letter === selected);

        let tone = 'border-white/10 bg-white/[0.03]';
        if (isCorrect) tone = 'border-emerald-400 bg-emerald-400/15';
        else if (isWrongLock) tone = 'border-red-400 bg-red-400/15';
        else if (isPicked) tone = 'border-[var(--stack-accent)] bg-[var(--stack-accent)]/10';

        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={letter}
            {...(onPick ? { type: 'button', onClick: () => onPick(letter), disabled } : {})}
            className={`flex min-h-[56px] items-center gap-3 rounded-xl border px-4 py-3 text-left transition duration-300 ${tone} ${
              disabled && onPick ? 'opacity-60' : ''
            } ${isCorrect || isWrongLock ? 'animate-stack-flash' : ''}`}
          >
            <span
              className={`flex ${big ? 'size-12 text-2xl' : 'size-8 text-sm'} shrink-0 items-center justify-center rounded-lg bg-white/10 font-bold`}
            >
              {letter}
            </span>
            <span className={big ? 'text-2xl' : 'text-base'}>{text}</span>
          </Tag>
        );
      })}
    </div>
  );
}

/**
 * The locked-in letter, full screen (PRD §3.3 step 4: "big white letter on
 * black"). Leaving this view does NOT disqualify anyone (V2-16), so it is a
 * plain panel with a way out, not a trap.
 */
export function BigLetter({ letter, caption, children }) {
  return (
    <div className="animate-stack-in flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center">
      <p className="mb-6 text-sm uppercase tracking-[0.3em] text-white/40">Locked In</p>
      <p
        key={letter}
        className="animate-stack-pop font-mono text-[40vw] font-bold leading-none text-white sm:text-[28vh]"
      >
        {letter}
      </p>
      {caption && <p className="mt-8 max-w-sm text-white/50">{caption}</p>}
      {children}
    </div>
  );
}

/** The question's Category strip, tinted by difficulty (PRD §3.4). */
export function QuestionHeader({ categoryName, dif, stageNumber, rotationNumber, selectorName, scale = 'sm' }) {
  const d = difficulty(dif);
  const big = scale === 'lg';
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 ${big ? 'py-4' : 'py-3'}`}
      style={{ borderColor: `${d.tint}66`, background: `${d.tint}12` }}
    >
      <div className="flex items-center gap-3">
        <span className={`font-bold ${big ? 'text-3xl' : 'text-lg'}`} style={{ color: d.tint }}>
          {d.label}
        </span>
        <span className={`font-semibold ${big ? 'text-3xl' : 'text-lg'}`}>{categoryName}</span>
      </div>
      <div className={`text-white/50 ${big ? 'text-xl' : 'text-sm'}`}>
        Stage {stageNumber} · Rotation {rotationNumber}
        {selectorName ? ` · ${selectorName} Selected` : ''}
      </div>
    </div>
  );
}

/** One row, its own component so `useCountUp` gets a stable hook order per
 * Team regardless of Teams joining or leaving around it (V2-13). */
function ScoreRow({ team, active, big }) {
  const shown = useCountUp(team.score);
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-4 ${big ? 'py-4' : 'py-3'} ${
        active ? 'border-[var(--stack-accent)] bg-[var(--stack-accent)]/10' : 'border-white/10'
      }`}
    >
      <span className="size-3 shrink-0 rounded-full" style={{ background: team.color }} />
      <span className={`truncate font-semibold ${big ? 'text-3xl' : 'text-base'}`}>{team.name}</span>
      <span className={`ml-auto font-mono font-bold tabular-nums ${big ? 'text-4xl' : 'text-xl'}`}>{shown}</span>
    </li>
  );
}

/** A live score row. Used by the Display home and the Scores peripheral. */
export function ScoreList({ teams, activeTeam, scale = 'sm' }) {
  const big = scale === 'lg';
  return (
    <ul className="flex flex-col gap-2">
      {teams.map((t) => (
        <ScoreRow key={t.teamId} team={t} active={t.teamId === activeTeam} big={big} />
      ))}
    </ul>
  );
}
