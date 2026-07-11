/**
 * @file Host setup: Category selection (PRD §3.2 step 2) and Stage setup
 * (step 3). Both Confirm straight into the room tree rather than into React
 * state, so a Host who refreshes mid-setup comes back to their choices and the
 * Display can show what is coming before anyone presses Begin.
 *
 * Three of the ten v1 defects are settled here, and none of them by a coat of
 * paint:
 *   #2  Uneven Category tiles   -> one uniform grid cell per Category.
 *   #7  Dropdowns auto-dismiss  -> `Select` closes only on an explicit choice.
 *   #8  Timer default unset     -> `DEFAULT_TIMER_SEC` = 30, on every Stage.
 *   #9  Numeric fields need arrow keys -> `NumberField` is a typeable text box.
 */

import { useMemo, useState } from 'react';
import { Banner, Button, Card, NumberField, Screen, Segmented, Select, TextInput, Tooltip } from '../components/ui.jsx';
import { CategoryGrid } from '../components/game.jsx';
import { withAvailability } from '../content/catalog.js';
import {
  CONTESTANTS,
  DEFAULT_TIER_SIZE,
  FIELD_HELP,
  LIMITS,
  ORDER_MODES,
  PENALTIES,
  contestantsOf,
  modeFor,
  normalizeStages,
  questionsNeeded,
} from '../state/stages.js';

/**
 * Step 2. Every Category is a tile of identical size showing its icon (or the
 * V2-8 numbered circle) and how many questions it has never shown. A Category at
 * zero is unselectable until its exposure is reset — which is a button on the
 * tile's row, not a trip to a database console.
 */
export function CategorySelect({ catalog, exposure, selected, tierSizes, onChange, onConfirm, onBack, busy }) {
  const [showDepleted, setShowDepleted] = useState(false);
  const [filter, setFilter] = useState('');

  const withCounts = useMemo(() => withAvailability(exposure.tree, catalog), [exposure.tree, catalog]);
  const chosen = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return withCounts.filter((c) => {
      if (c.depleted && !showDepleted && !chosen.has(c.slug)) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle) || c.slug.includes(needle);
    });
  }, [withCounts, filter, showDepleted, chosen]);

  const items = visible.map((c) => ({
    slug: c.slug,
    name: c.name,
    icon: c.iconSrc,
    n: c.n,
    badge: c.depleted ? 'None Left' : `${c.available} Available`,
    disabled: c.depleted,
  }));

  const depletedCount = withCounts.filter((c) => c.depleted).length;
  const selectedCats = withCounts.filter((c) => chosen.has(c.slug));

  function toggle(slug) {
    const next = chosen.has(slug) ? selected.filter((s) => s !== slug) : [...selected, slug];
    onChange({ selected: next, tierSizes });
  }

  function setTierSize(slug, n) {
    onChange({ selected, tierSizes: { ...tierSizes, [slug]: n } });
  }

  return (
    <Screen>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5 pb-28">
        <header>
          <p className="text-sm text-white/40">Step 1 of 2</p>
          <h1 className="text-2xl font-semibold">Choose Your Categories</h1>
          <p className="mt-1 text-sm text-white/50">
            Each Category shows how many of its questions have never been played.
          </p>
        </header>

        {exposure.blocked && (
          <Banner tone="warn">
            The used-question memory could not be read, so every question is being treated as fresh. Publish the
            Database rules to fix this — the Game plays correctly either way.
          </Banner>
        )}

        <TextInput
          label="Search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name"
        />

        <CategoryGrid items={items} onPick={toggle} selected={selected} />

        {items.length === 0 && (
          <Card className="text-center text-white/40">No Categories match that search.</Card>
        )}

        {depletedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowDepleted((v) => !v)}
            className="min-h-[44px] text-sm text-white/50 underline-offset-4 hover:underline"
          >
            {showDepleted ? 'Hide' : 'Show'} {depletedCount} played-out{' '}
            {depletedCount === 1 ? 'Category' : 'Categories'}
          </button>
        )}

        {showDepleted && depletedCount > 0 && (
          <Card>
            <h2 className="mb-1 font-semibold">Played-Out Categories</h2>
            <p className="mb-3 text-sm text-white/50">
              Every question has been shown in an earlier Game. Reset one to make it selectable again.
            </p>
            <ul className="flex flex-col gap-2">
              {withCounts
                .filter((c) => c.depleted)
                .map((c) => (
                  <li key={c.slug} className="flex items-center gap-3">
                    <span className="truncate">{c.name}</span>
                    <Button
                      variant="secondary"
                      className="ml-auto shrink-0 !px-3 text-sm"
                      onClick={() => exposure.reset(c.slug)}
                    >
                      Reset
                    </Button>
                  </li>
                ))}
            </ul>
          </Card>
        )}

        {selectedCats.length > 0 && (
          <Card>
            <h2 className="mb-1 flex items-center font-semibold">
              Questions per Tier
              <Tooltip text={FIELD_HELP.tierSize} label="What does Questions per Tier mean?" />
            </h2>
            <p className="mb-4 text-sm text-white/50">
              How many Easy, Medium and Hard questions each Category puts on the board. A Category with fewer than
              this contributes what it has.
            </p>
            <ul className="flex flex-col gap-4">
              {selectedCats.map((c) => {
                const n = tierSizes[c.slug] || DEFAULT_TIER_SIZE;
                return (
                  <li key={c.slug} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.name}</p>
                      <p className="text-xs text-white/40">
                        {c.tiers.E} Easy · {c.tiers.M} Medium · {c.tiers.H} Hard unplayed
                      </p>
                    </div>
                    <NumberField
                      id={`tier-${c.slug}`}
                      ariaLabel={`Questions per Tier for ${c.name}`}
                      value={n}
                      min={LIMITS.tierSize.min}
                      max={LIMITS.tierSize.max}
                      onChange={(v) => setTierSize(c.slug, v)}
                      className="w-40"
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      <div className="sticky bottom-0 flex gap-3 border-t border-white/10 bg-[var(--stack-bg)]/95 p-4 backdrop-blur">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={onConfirm} disabled={busy || selected.length === 0}>
          {selected.length === 0
            ? 'Choose at least one Category'
            : `Confirm ${selected.length} ${selected.length === 1 ? 'Category' : 'Categories'}`}
        </Button>
      </div>
    </Screen>
  );
}

/** One Stage's card. Every field is typeable, steppable, or explicitly chosen. */
function StageCard({ index, stage, teamCount, onChange }) {
  const set = (patch) => onChange({ ...stage, ...patch });

  return (
    <Card>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Stage {index + 1}</h2>
        <span className="text-sm text-white/40">
          {stage.rotations * Math.max(teamCount, 1)} questions
        </span>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            id={`rotations-${index}`}
            label="Rotations"
            tooltip={FIELD_HELP.rotations}
            value={stage.rotations}
            min={LIMITS.rotations.min}
            max={LIMITS.rotations.max}
            onChange={(v) => set({ rotations: v })}
          />
          <NumberField
            id={`timer-${index}`}
            label="Thinking Time"
            tooltip={FIELD_HELP.timerSec}
            value={stage.timerSec}
            min={LIMITS.timerSec.min}
            max={LIMITS.timerSec.max}
            suffix="s"
            onChange={(v) => set({ timerSec: v })}
          />
          <NumberField
            id={`multiplier-${index}`}
            label="Multiplier"
            tooltip={FIELD_HELP.multiplier}
            value={stage.multiplier}
            min={LIMITS.multiplier.min}
            max={LIMITS.multiplier.max}
            onChange={(v) => set({ multiplier: v })}
          />
          <Segmented
            label="Penalty"
            tooltip={FIELD_HELP.penalty}
            options={PENALTIES}
            value={stage.penalty}
            onChange={(v) => set({ penalty: v })}
          />
        </div>

        <Segmented
          label="Contestants"
          options={CONTESTANTS}
          value={contestantsOf(stage)}
          onChange={(v) => set({ mode: modeFor(v) })}
        />
        <p className="-mt-2 text-xs text-white/40">
          {CONTESTANTS.find((c) => c.value === contestantsOf(stage)).hint}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Who Selects First"
            tooltip={FIELD_HELP.orderMode}
            options={ORDER_MODES}
            value={stage.orderMode}
            onChange={(v) => set({ orderMode: v })}
          />
          <Select
            label="Who Selects Next"
            tooltip={FIELD_HELP.orderModeNext}
            options={ORDER_MODES}
            value={stage.orderModeNext}
            onChange={(v) => set({ orderModeNext: v })}
          />
        </div>
      </div>
    </Card>
  );
}

/** Step 3 (PRD §3.2): the four Stages of the Game. */
export function StageSetup({ stages, teamCount, questionsOnBoard, onChange, onConfirm, onBack, busy }) {
  const needed = questionsNeeded(stages, teamCount);
  const short = questionsOnBoard != null && needed > questionsOnBoard;

  return (
    <Screen>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5 pb-28">
        <header>
          <p className="text-sm text-white/40">Step 2 of 2</p>
          <h1 className="text-2xl font-semibold">Set Up the Stages</h1>
          <p className="mt-1 text-sm text-white/50">
            A Game has four Stages. Each Stage runs a set number of Rotations — one selection turn per Team.
          </p>
        </header>

        {short && (
          <Banner tone="warn">
            These Stages could run {needed} questions, but only {questionsOnBoard} will be drawn. The Game ends when
            the board runs dry. Add Categories, raise Questions per Tier, or cut Rotations.
          </Banner>
        )}

        {stages.map((stage, i) => (
          <StageCard
            key={i}
            index={i}
            stage={stage}
            teamCount={teamCount}
            onChange={(next) => onChange(stages.map((s, j) => (j === i ? next : s)))}
          />
        ))}
      </div>

      <div className="sticky bottom-0 flex gap-3 border-t border-white/10 bg-[var(--stack-bg)]/95 p-4 backdrop-blur">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm Stages'}
        </Button>
      </div>
    </Screen>
  );
}

/** Normalize whatever came out of the room tree into four editable Stages. */
export function stagesFromRoom(room) {
  return normalizeStages(room && room.settings && room.settings.rounds);
}
