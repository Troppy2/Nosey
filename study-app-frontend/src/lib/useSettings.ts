import { useEffect, useState } from "react";
import { scopeKey } from "./api";

export const SETTINGS_KEYS = {
  questionFallback: "nosey_question_fallback",
  generationProvider: "nosey_generation_provider",
  kojoStrictness: "nosey_kojo_strictness",
  betaMode: "nosey_beta_mode",
} as const;

function readBooleanSetting(key: string, defaultValue: boolean) {
  if (typeof window === "undefined") return defaultValue;
  const val = localStorage.getItem(key);
  if (val === null) return defaultValue;
  return val !== "false";
}

function readStringSetting(key: string, defaultValue: string) {
  if (typeof window === "undefined") return defaultValue;
  return localStorage.getItem(key) ?? defaultValue;
}

// Writes to localStorage and notifies all useSettings instances in the same tab.
function writeSetting(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
}

export function useSettings() {
  const [questionFallbackEnabled, setQuestionFallbackEnabledState] = useState(() =>
    readBooleanSetting(scopeKey(SETTINGS_KEYS.questionFallback), false),
  );
  const [generationProvider, setGenerationProviderState] = useState(() =>
    readStringSetting(scopeKey(SETTINGS_KEYS.generationProvider), "ollama"),
  );
  const [kojoStrictness, setKojoStrictnessState] = useState(() =>
    readStringSetting(scopeKey(SETTINGS_KEYS.kojoStrictness), "medium"),
  );
  const [betaMode, setBetaModeState] = useState(() =>
    readBooleanSetting(scopeKey(SETTINGS_KEYS.betaMode), false),
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
