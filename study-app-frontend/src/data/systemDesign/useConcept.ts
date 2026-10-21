import { useEffect, useState } from "react";

import { listSystemDesignCustomTopics } from "../../lib/api";
import { getConcept } from "./index";
import type { Concept } from "./types";

export const CUSTOM_CONCEPT_PREFIX = "custom-";

export function isCustomConceptId(id: string | undefined): boolean {
  return Boolean(id && id.startsWith(CUSTOM_CONCEPT_PREFIX));
}

/**
 * A built-in concept resolves synchronously from the bundle. A custom one
 * ("custom-<n>") is fetched, so callers wait on `loading` before treating a
 * null concept as "not found".
 */
export function useConcept(id: string | undefined): { concept: Concept | null; loading: boolean } {
  const builtIn = getConcept(id);
  const custom = !builtIn && isCustomConceptId(id);
  const [fetched, setFetched] = useState<{ id: string; concept: Concept | null } | null>(null);

  useEffect(() => {
    if (!custom || !id) return;
    let cancelled = false;
    listSystemDesignCustomTopics()
      .then((topics) => {
        if (!cancelled) setFetched({ id, concept: topics.find((topic) => topic.id === id) ?? null });
      })
      .catch(() => {
        if (!cancelled) setFetched({ id, concept: null });
      });
    return () => {
      cancelled = true;
    };
  }, [custom, id]);

  if (builtIn) return { concept: builtIn, loading: false };
  if (!custom) return { concept: null, loading: false };
  if (!fetched || fetched.id !== id) return { concept: null, loading: true };
  return { concept: fetched.concept, loading: false };
}
