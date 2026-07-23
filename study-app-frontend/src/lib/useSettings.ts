import { useEffect, useState } from "react";
import { getStoredUser, scopeKey } from "./api";

export const SETTINGS_KEYS = {
  questionFallback: "nosey_question_fallback",
  generationProvider: "nosey_generation_provider",
  kojoStrictness: "nosey_kojo_strictness",
  kojoCustomInstruction: "nosey_kojo_custom_instruction",
  weaknessSensitivity: "nosey_lc_weakness_sensitivity",
  difficultyPrompt: "nosey_lc_difficulty_prompt",
} as const;

// Kojo custom instructions are capped so they can't crowd out the notes context
// or blow the prompt budget. Enforced on write; the backend clamps again.
export const KOJO_CUSTOM_INSTRUCTION_MAX = 500;

// Key used by api.ts to store the current user record. Beta access is derived
// from that record (admin-granted), so we watch it for cross-tab/login changes.
const USER_KEY = "nosey_user";

// Beta access is no longer a user self-serve toggle. It is granted by an admin
// (User.is_beta) and admins always have it, mirroring how admins are ungated
// everywhere else. Derived from the stored user record, not localStorage.
function deriveBetaAccess(): boolean {
  const user = getStoredUser();
  return !!user && (user.is_admin === true || user.is_beta === true);
}

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
  const [kojoCustomInstruction, setKojoCustomInstructionState] = useState(() =>
    readStringSetting(SETTINGS_KEYS.kojoCustomInstruction, ""),
  );
  // How aggressively KojoCode flags weak topics (low | medium | high). Read by the
  // weakness fetches and set from the KojoCode dashboard cog.
  const [weaknessSensitivity, setWeaknessSensitivityState] = useState(() =>
    readStringSetting(SETTINGS_KEYS.weaknessSensitivity, "medium"),
  );
  // Whether to ask "how hard did that feel?" after finishing a KojoCode problem.
  const [difficultyPromptEnabled, setDifficultyPromptEnabledState] = useState(() =>
    readBooleanSetting(SETTINGS_KEYS.difficultyPrompt, true),
  );
  const [betaMode, setBetaModeState] = useState(deriveBetaAccess);

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
      if (e.key === scopeKey(SETTINGS_KEYS.kojoCustomInstruction) && e.newValue !== null) {
        setKojoCustomInstructionState(e.newValue);
      }
      if (e.key === scopeKey(SETTINGS_KEYS.weaknessSensitivity) && e.newValue !== null) {
        setWeaknessSensitivityState(e.newValue);
      }
      if (e.key === scopeKey(SETTINGS_KEYS.difficultyPrompt) && e.newValue !== null) {
        setDifficultyPromptEnabledState(e.newValue !== "false");
      }
      // Beta access follows the stored user record (admin-granted). Re-derive
      // when it changes in another tab (login/logout or an admin grant picked
      // up on refresh).
      if (e.key === USER_KEY) {
        setBetaModeState(deriveBetaAccess());
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

  function setKojoCustomInstruction(value: string) {
    const clamped = value.slice(0, KOJO_CUSTOM_INSTRUCTION_MAX);
    setKojoCustomInstructionState(clamped);
    writeSetting(scopeKey(SETTINGS_KEYS.kojoCustomInstruction), clamped);
  }

  function setWeaknessSensitivity(value: string) {
    setWeaknessSensitivityState(value);
    writeSetting(scopeKey(SETTINGS_KEYS.weaknessSensitivity), value);
  }

  function setDifficultyPromptEnabled(value: boolean) {
    setDifficultyPromptEnabledState(value);
    writeSetting(scopeKey(SETTINGS_KEYS.difficultyPrompt), String(value));
  }

  return {
    questionFallbackEnabled,
    setQuestionFallbackEnabled,
    generationProvider,
    setGenerationProvider,
    kojoStrictness,
    setKojoStrictness,
    kojoCustomInstruction,
    setKojoCustomInstruction,
    weaknessSensitivity,
    setWeaknessSensitivity,
    difficultyPromptEnabled,
    setDifficultyPromptEnabled,
    betaMode,
  };
}
