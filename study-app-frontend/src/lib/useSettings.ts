import { useEffect, useState } from "react";
import { scopeKey } from "./api";

export const SETTINGS_KEYS = {
  questionFallback: "nosey_question_fallback",
  generationProvider: "nosey_generation_provider",
  kojoStrictness: "nosey_kojo_strictness",
  betaMode: "nosey_beta_mode",
} as const;

// Resolves a setting value from the user-scoped key, falling back to the legacy
// unscoped key written before scopeKey existed. When a legacy value is found it
// is migrated forward to the scoped key so this only happens once. Without this,
// settings saved before key scoping (e.g. beta mode) silently read as default.
function resolveSettingValue(bareKey: string): string | null {
  const scoped = scopeKey(bareKey);
  const scopedVal = localStorage.getItem(scoped);
  if (scopedVal !== null) return scopedVal;
  // No scoped value yet. Migrate the legacy unscoped value if one exists.
  if (scoped !== bareKey) {
    const legacy = localStorage.getItem(bareKey);
    if (legacy !== null) {
      localStorage.setItem(scoped, legacy);
      return legacy;
    }
  }
  return null;
}

function readBooleanSetting(bareKey: string, defaultValue: boolean) {
  if (typeof window === "undefined") return defaultValue;
  const val = resolveSettingValue(bareKey);
  if (val === null) return defaultValue;
  return val !== "false";
}

function readStringSetting(bareKey: string, defaultValue: string) {
  if (typeof window === "undefined") return defaultValue;
  return resolveSettingValue(bareKey) ?? defaultValue;
}

// Writes to localStorage and notifies all useSettings instances in the same tab.
function writeSetting(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
}

export function useSettings() {
  const [questionFallbackEnabled, setQuestionFallbackEnabledState] = useState(() =>
    readBooleanSetting(SETTINGS_KEYS.questionFallback, false),
  );
  const [generationProvider, setGenerationProviderState] = useState(() =>
    readStringSetting(SETTINGS_KEYS.generationProvider, "ollama"),
  );
  const [kojoStrictness, setKojoStrictnessState] = useState(() =>
    readStringSetting(SETTINGS_KEYS.kojoStrictness, "medium"),
  );
  const [betaMode, setBetaModeState] = useState(() =>
    readBooleanSetting(SETTINGS_KEYS.betaMode, false),
  );

  // Sync state when another instance of useSettings writes a setting.
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === scopeKey(SETTINGS_KEYS.questionFallback) && e.newValue !== null) {
        setQuestionFallbackEnabledState(e.newValue !== "false");
      }
      if (e.key === scopeKey(SETTINGS_KEYS.generationProvider) && e.newValue !== null) {
        setGenerationProviderState(e.newValue);
      }
      if (e.key === scopeKey(SETTINGS_KEYS.kojoStrictness) && e.newValue !== null) {
        setKojoStrictnessState(e.newValue);
      }
      if (e.key === scopeKey(SETTINGS_KEYS.betaMode) && e.newValue !== null) {
        setBetaModeState(e.newValue !== "false");
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function setQuestionFallbackEnabled(value: boolean) {
    setQuestionFallbackEnabledState(value);
    writeSetting(scopeKey(SETTINGS_KEYS.questionFallback), String(value));
  }

  function setGenerationProvider(value: string) {
    setGenerationProviderState(value);
    writeSetting(scopeKey(SETTINGS_KEYS.generationProvider), value);
  }

  function setKojoStrictness(value: string) {
    setKojoStrictnessState(value);
    writeSetting(scopeKey(SETTINGS_KEYS.kojoStrictness), value);
  }

  function setBetaMode(value: boolean) {
    setBetaModeState(value);
    writeSetting(scopeKey(SETTINGS_KEYS.betaMode), String(value));
  }

  return {
    questionFallbackEnabled,
    setQuestionFallbackEnabled,
    generationProvider,
    setGenerationProvider,
    kojoStrictness,
    setKojoStrictness,
    betaMode,
    setBetaMode,
  };
}
