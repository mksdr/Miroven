"use client";
import { useEffect, useState } from "react";
import { readPersona } from "../lib/vault/persona";
import type { Persona } from "../lib/persona";

export function usePersona({ hydrated, locked, scope, refreshToken }: {
  hydrated: boolean; locked: boolean; scope: string; refreshToken: unknown;
}) {
  const [loaded, setLoaded] = useState<{ scope: string; persona: Persona | null; error: boolean }>();
  useEffect(() => {
    let cancelled = false;
    if (!hydrated || locked) {
      queueMicrotask(() => { if (!cancelled) setLoaded(undefined); });
      return () => { cancelled = true; };
    }
    void readPersona().then(persona => { if (!cancelled) setLoaded({ scope, persona, error: false }); })
      .catch(() => { if (!cancelled) setLoaded({ scope, persona: null, error: true }); });
    return () => { cancelled = true; };
  }, [hydrated, locked, scope, refreshToken]);
  const available = hydrated && !locked && loaded?.scope === scope;
  return { persona: available ? loaded.persona : null, ready: available && !loaded.error };
}
