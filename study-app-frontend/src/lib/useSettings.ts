import { useEffect, useState } from "react";

export const SETTINGS_KEYS = {
  betaEnabled: "nosey_beta_mode",
  questionFallback: "nosey_question_fallback",
  generationProvider: "nosey_generation_provider",
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
  const [isBetaEnabled, setIsBetaEnabledState] = useState(() =>
    readBooleanSetting(SETTINGS_KEYS.betaEnabled, false),
  );
  const [questionFallbackEnabled, setQuestionFallbackEnabledState] = useState(() =>
    readBooleanSetting(SETTINGS_KEYS.questionFallback, true),
  );
  const [generationProvider, setGenerationProviderState] = useState(() =>
    readStringSetting(SETTINGS_KEYS.generationProvider, "auto"),
  );

  // Sync state when another instance of useSettings writes a setting.
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === SETTINGS_KEYS.betaEnabled && e.newValue !== null) {
        setIsBetaEnabledState(e.newValue !== "false");
      }
      if (e.key === SETTINGS_KEYS.questionFallback && e.newValue !== null) {
        setQuestionFallbackEnabledState(e.newValue !== "false");
      }
      if (e.key === SETTINGS_KEYS.generationProvider && e.newValue !== null) {
        setGenerationProviderState(e.newValue);
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function setIsBetaEnabled(value: boolean) {
    setIsBetaEnabledState(value);
    writeSetting(SETTINGS_KEYS.betaEnabled, String(value));
  }

  function setQuestionFallbackEnabled(value: boolean) {
    setQuestionFallbackEnabledState(value);
    writeSetting(SETTINGS_KEYS.questionFallback, String(value));
  }

  function setGenerationProvider(value: string) {
    setGenerationProviderState(value);
    writeSetting(SETTINGS_KEYS.generationProvider, value);
  }

  return {
    isBetaEnabled,
    setIsBetaEnabled,
    questionFallbackEnabled,
    setQuestionFallbackEnabled,
    generationProvider,
    setGenerationProvider,
  };
}
