/**
 * @file Two Host-only hooks: the Category bank, and the cross-game exposure
 * memory it is filtered against.
 *
 * Both degrade rather than fail. A Host whose exposure tree cannot be read —
 * which is the state of the live database until Michael publishes
 * `firebase-rules.json` (S2's outstanding blocker) — gets an EMPTY tree, every
 * question treated as fresh, and a banner. A Game must never be unhostable
 * because a memory of last month's Game is unreachable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCatalog } from '../content/catalog.js';
import { createExposureStore } from '../state/exposure.js';
import { loadExposureBackend } from './driver.js';

/**
 * The whole Category bank, icon-resolved. Cached at module level in
 * `loadCatalog`, so StrictMode's double mount costs one fetch, not two.
 * @returns {{categories: Array<Object>, parseErrors: Array<Object>, loading: boolean, error: ?Error}}
 */
export function useCatalog() {
  const [state, setState] = useState({ categories: [], parseErrors: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then(({ categories, errors }) => {
        if (!cancelled) setState({ categories, parseErrors: errors, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ categories: [], parseErrors: [], loading: false, error });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * The exposure store for this session's driver (V2-5 real / V2-21 offline),
 * loaded once and mirrored into React state.
 *
 * @returns {{tree: Object, store: ?Object, ready: boolean, blocked: boolean, record: Function, reset: Function}}
 *   `blocked` is true when the backend refused the read — the rules aren't
 *   published yet. The Game proceeds against an empty tree (S4 requirement 5).
 */
export function useExposure() {
  const [tree, setTree] = useState({});
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const storeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    loadExposureBackend()
      .then((backend) => {
        if (cancelled) return null;
        const store = createExposureStore(backend);
        storeRef.current = store;
        unsubscribe = store.subscribe((next) => {
          if (!cancelled) setTree(next);
        });
        return store.load();
      })
      .then((loaded) => {
        if (cancelled || !loaded) return;
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Denied or unreachable. An empty tree means "nothing has been asked
        // yet", which is the safe direction to be wrong in: questions repeat,
        // rather than the board coming up empty.
        setBlocked(true);
        setReady(true);
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  /** Record refs as exposed. Never throws — a lost write costs a repeat. */
  const record = useCallback(async (refs, at) => {
    const store = storeRef.current;
    if (!store) return;
    try {
      await store.record(refs, at);
    } catch {
      /* the reveal already happened; the memory of it is best-effort */
    }
  }, []);

  /** Host: unlock a depleted Category (PRD §3.2), or all of them. */
  const reset = useCallback(async (slug = null) => {
    const store = storeRef.current;
    if (!store) return;
    try {
      await store.reset(slug);
    } catch {
      /* leave the cache optimistically cleared; the next load re-reads truth */
    }
  }, []);

  return useMemo(
    () => ({ tree, store: storeRef.current, ready, blocked, record, reset }),
    [tree, ready, blocked, record, reset]
  );
}
