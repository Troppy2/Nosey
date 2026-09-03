// Speech helpers shared by the article lesson player and the episode player
// (podcast / video-lecture). Extracted from LearningModuleLesson.tsx so the
// math normalizer has exactly one home: two copies would drift and the voice
// would start reading raw notation again.

// Converts notation TTS engines mangle or skip into the words a teacher would
// say aloud: Big-O, exponents, subscripts, comparison operators, indexing, and
// function calls. Runs on every speech block as a safety net; the LLM-written
// narration script should already be plain prose, but raw notation must never
// reach the voice as symbols it silently drops.
export function notationToSpeech(text: string): string {
  let out = text;
  // Complexity classes first, before the generic call rule: O(n log n) -> "O of n log n".
  // (?<!\w) instead of \b because \b never matches before the non-ASCII Θ/Ω.
  out = out.replace(/(?<!\w)(O|Θ|Theta|Ω|Omega)\(([^()]*)\)/g, (_m, fn: string, inner: string) => {
    const name = fn === "Θ" ? "big theta" : fn === "Ω" ? "big omega" : fn === "O" ? "O" : fn;
    return `${name} of ${inner}`;
  });
  // Common LaTeX commands that survive stripping.
  out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, " $1 over $2 ");
  out = out.replace(/\\sqrt\{?\(?([\w+\-^ ]+)\)?\}?/g, " the square root of $1 ");
  out = out.replace(/\\sum\b/g, " the sum of ");
  out = out.replace(/\\int\b/g, " the integral of ");
  out = out.replace(/\\infty\b/g, " infinity ");
  out = out.replace(/\\pi\b/g, " pi ");
  out = out.replace(/\\cdot\b|\\times\b|×|·/g, " times ");
  out = out.replace(/\\le(q)?\b/g, " less than or equal to ");
  out = out.replace(/\\ge(q)?\b/g, " greater than or equal to ");
  out = out.replace(/\\ne(q)?\b/g, " not equal to ");
  // Unknown LaTeX commands read as gibberish; drop the backslash word, keep args.
  out = out.replace(/\\[a-zA-Z]+/g, " ");
  // Exponents and subscripts: n^2 "n squared", x^k "x to the power of k", a_i "a sub i".
  out = out.replace(/(\w)\^\{?2\}?(?!\w)/g, "$1 squared");
  out = out.replace(/(\w)\^\{?3\}?(?!\w)/g, "$1 cubed");
  out = out.replace(/(\w)\^\{?([\w+\-]+)\}?/g, "$1 to the power of $2");
  out = out.replace(/\b(\w)_\{?(\w+)\}?/g, "$1 sub $2");
  // Operators the voice skips or misreads.
  out = out.replace(/<=/g, " less than or equal to ");
  out = out.replace(/>=/g, " greater than or equal to ");
  out = out.replace(/!==?/g, " not equal to ");
  out = out.replace(/===?/g, " equals ");
  out = out.replace(/(\s)=(\s)/g, "$1equals$2");
  out = out.replace(/(\s)\+(\s)/g, "$1plus$2");
  out = out.replace(/(\s)\*(\s)/g, "$1times$2");
  out = out.replace(/->|→/g, " to ");
  out = out.replace(/\bn!/g, "n factorial");
  // Code shapes: arr[i] "arr at index i", foo() "the foo function", f(x) "f of x".
  out = out.replace(/\b(\w+)\[(\w+)\]/g, "$1 at index $2");
  out = out.replace(/\b([a-zA-Z_]\w*)\(\)/g, "the $1 function");
  out = out.replace(/\b([a-zA-Z_]\w*)\(([^()]*)\)/g, "$1 of $2");
  // Leftover braces from LaTeX arguments.
  out = out.replace(/[{}]/g, " ");
  return out;
}

// Converts markdown into plain sentences the Web Speech API can read without
// announcing syntax. Fenced code blocks are summarized (reading code line by
// line aloud is worse than useless); everything else, including inline math
// and code spans, is unwrapped and passed through notationToSpeech so the
// voice reads "O of n" instead of skipping "O(n)".
export function markdownToSpeech(markdown: string): string {
  let text = markdown;
  text = text.replace(/```[\s\S]*?```/g, " Here, see the code example on screen. ");
  // Unwrap math instead of hiding it; notationToSpeech makes it speakable.
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, " $1 ");
  text = text.replace(/\$([^$\n]+)\$/g, " $1 ");
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/^[-*+]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/\|/g, " ");
  text = notationToSpeech(text);
  return text.replace(/\s+/g, " ").trim();
}

// Chrome silently stops long utterances, so a block of speech is split into
// short chunks that are queued one after another.
export function splitForSpeech(text: string, maxLen = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// A speechCapability() result. speechSynthesis exists in every modern browser
// but is unusable in some (notably older mobile Safari, and any browser with
// no installed voices). Both conditions have to be checked: an empty voice
// list plays silence.
export type SpeechCapability = { usable: boolean; reason?: string };

export function speechCapability(): SpeechCapability {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return { usable: false, reason: "This browser cannot play synthesized speech." };
  }
  const voices = window.speechSynthesis.getVoices();
  // getVoices() is async-populated: an empty list here is inconclusive until
  // voiceschanged fires, so callers must re-check after that event.
  return { usable: true };
}

// Voice assignment for the episode player. The two podcast speakers MUST be
// two different TTS voices. A listener with no visual cue has only the voice
// to tell them who is talking, so this is a correctness requirement, not a
// nicety.
//
// Accent is the strongest, most instantly recognizable difference the Web
// Speech API gives us, so the cast is assigned by locale:
//   expert -> en-GB (British)
//   host   -> en-US (American)
// Degradation, in order, when the device does not have both:
//   1. Both accents present: use them. This is the target.
//   2. Only one accent present: two different English voices from what exists.
//   3. Only one usable English voice: same voice, pitch and rate offset on the
//      expert. Weakest option, but still two audibly distinct speakers.
// A lecture is single-voice and just takes the best available.
export type CastVoices = Record<
  string,
  { voice: SpeechSynthesisVoice | null; pitch: number; rate: number }
>;

export function castFor(format: "podcast" | "lecture", voices: SpeechSynthesisVoice[]): CastVoices {
  // Google voices first where present (Chrome), for quality.
  const rank = (v: SpeechSynthesisVoice) => (v.name.includes("Google") ? 0 : 1);
  const byQuality = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name);

  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = [...(english.length ? english : voices)].sort(byQuality);
  const withLang = (prefix: string) =>
    pool.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix));

  if (format === "lecture") {
    // A single clear narrator. Prefer en-US, fall back to anything usable.
    return { lecturer: { voice: withLang("en-us")[0] ?? pool[0] ?? null, pitch: 1, rate: 1 } };
  }

  const british = withLang("en-gb");
  const american = withLang("en-us");
  let expert: SpeechSynthesisVoice | null = british[0] ?? null;
  let host: SpeechSynthesisVoice | null = american[0] ?? null;

  // Fill whichever side the device could not satisfy, never with the voice
  // already taken by the other speaker.
  const distinctFrom = (taken: SpeechSynthesisVoice | null) =>
    pool.find((v) => v.voiceURI !== taken?.voiceURI) ?? null;
  if (!expert) expert = distinctFrom(host);
  if (!host) host = distinctFrom(expert);

  if (host && expert && host.voiceURI !== expert.voiceURI) {
    return {
      host: { voice: host, pitch: 1, rate: 1 },
      expert: { voice: expert, pitch: 1, rate: 1 },
    };
  }
  // Last resort: one voice, differentiated by pitch and rate.
  const only = host ?? expert ?? null;
  return {
    host: { voice: only, pitch: 1.08, rate: 1 },
    expert: { voice: only, pitch: 0.82, rate: 0.95 },
  };
}