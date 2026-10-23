import { EXPERT_VOICE, NARRATION_CHUNK_CHARS, NARRATION_VOICE, narrationSupported } from "../lib/narration";

// Speech helpers shared by the article lesson player and the episode player
// (podcast / video-lecture). Extracted from LearningModuleLesson.tsx so the
// math normalizer has exactly one home: two copies would drift and the voice
// would start reading raw notation again.

// Converts notation TTS engines mangle or skip into the words a teacher would
// say aloud: Big-O, exponents, subscripts, comparison operators, indexing, and
// function calls. Runs on every speech block as a safety net; the LLM-written
// narration script should already be plain prose, but raw notation must never
// reach the voice as symbols it silently drops.
// Greek letters and math symbols, spoken as words. A voice model skips them otherwise (a raw alpha or
// a leftover backslash command is read as silence), which made math lessons unlistenable.
const GREEK_NAMES: Record<string, string> = {
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  epsilon: "epsilon",
  zeta: "zeta",
  eta: "eta",
  theta: "theta",
  iota: "iota",
  kappa: "kappa",
  lambda: "lambda",
  mu: "mu",
  nu: "nu",
  xi: "xi",
  omicron: "omicron",
  pi: "pi",
  rho: "rho",
  sigma: "sigma",
  tau: "tau",
  upsilon: "upsilon",
  phi: "phi",
  chi: "chi",
  psi: "psi",
  omega: "omega",
  varepsilon: "epsilon",
  vartheta: "theta",
  varphi: "phi",
  varrho: "rho",
  varsigma: "sigma",
  Gamma: "capital gamma",
  Delta: "capital delta",
  Theta: "capital theta",
  Lambda: "capital lambda",
  Xi: "capital xi",
  Pi: "capital pi",
  Sigma: "capital sigma",
  Upsilon: "capital upsilon",
  Phi: "capital phi",
  Psi: "capital psi",
  Omega: "capital omega",
};
const GREEK_UNICODE: Record<string, string> = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  ε: "epsilon",
  ζ: "zeta",
  η: "eta",
  θ: "theta",
  ι: "iota",
  κ: "kappa",
  λ: "lambda",
  μ: "mu",
  ν: "nu",
  ξ: "xi",
  π: "pi",
  ρ: "rho",
  σ: "sigma",
  ς: "sigma",
  τ: "tau",
  υ: "upsilon",
  φ: "phi",
  χ: "chi",
  ψ: "psi",
  ω: "omega",
  ϕ: "phi",
  ϵ: "epsilon",
  ϑ: "theta",
  Γ: "capital gamma",
  Δ: "capital delta",
  Λ: "capital lambda",
  Ξ: "capital xi",
  Π: "capital pi",
  Σ: "capital sigma",
  Φ: "capital phi",
  Ψ: "capital psi",
};
const MATH_SYMBOLS: Record<string, string> = {
  "≤": " less than or equal to ",
  "≥": " greater than or equal to ",
  "≠": " not equal to ",
  "≈": " approximately equal to ",
  "±": " plus or minus ",
  "÷": " divided by ",
  "√": " the square root of ",
  "∑": " the sum of ",
  "∫": " the integral of ",
  "∞": " infinity ",
  "∈": " is in ",
  "∉": " is not in ",
  "⊂": " is a subset of ",
  "⊆": " is a subset of or equal to ",
  "∪": " union ",
  "∩": " intersection ",
  "∀": " for all ",
  "∃": " there exists ",
  "∂": " partial ",
  "∇": " nabla ",
  "°": " degrees ",
  "∝": " is proportional to ",
  "≡": " is congruent to ",
  "⇒": " implies ",
  "⇔": " if and only if ",
};
const LATEX_SYMBOLS: Record<string, string> = {
  pm: " plus or minus ",
  div: " divided by ",
  approx: " approximately equal to ",
  in: " is in ",
  notin: " is not in ",
  subset: " is a subset of ",
  subseteq: " is a subset of or equal to ",
  cup: " union ",
  cap: " intersection ",
  forall: " for all ",
  exists: " there exists ",
  partial: " partial ",
  nabla: " nabla ",
  propto: " is proportional to ",
  equiv: " is congruent to ",
  Rightarrow: " implies ",
  Leftrightarrow: " if and only if ",
  to: " to ",
  rightarrow: " to ",
  leftarrow: " from ",
};

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
  // LaTeX Greek letters and symbol commands, then the same characters typed directly.
  out = out.replace(/\\([a-zA-Z]+)(?![a-zA-Z])/g, (m, name: string) =>
    GREEK_NAMES[name] !== undefined ? ` ${GREEK_NAMES[name]} ` : (LATEX_SYMBOLS[name] ?? m),
  );
  out = out.replace(/[\u0370-\u03ff\u1f00-\u1fff]/g, (ch) => (GREEK_UNICODE[ch] !== undefined ? ` ${GREEK_UNICODE[ch]} ` : ch));
  out = out.replace(/[≤≥≠≈±÷√∑∫∞∈∉⊂⊆∪∩∀∃∂∇°∝≡⇒⇔]/g, (ch) => MATH_SYMBOLS[ch]);
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

// A block of speech is split into short chunks that are queued one after
// another (each chunk is one narration clip).
export function splitForSpeech(text: string, maxLen = NARRATION_CHUNK_CHARS): string[] {
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

// Narration runs on the server voice, so it only needs audio playback.
export type SpeechCapability = { usable: boolean; reason?: string };

export function speechCapability(): SpeechCapability {
  return narrationSupported()
    ? { usable: true }
    : { usable: false, reason: "This browser cannot play audio." };
}

// Voice assignment for the episode player. The two podcast speakers MUST be
// two different voices: a listener with no visual cue has only the voice to
// tell them who is talking, so this is a correctness requirement.
//   host -> af_heart (the voice every lesson uses)
//   expert -> bm_george (a British male voice, clearly different)
// A lecture (slide deck) is single-voice and uses the lesson voice.
export type CastVoices = Record<string, { voice: string; rate: number }>;

export function castFor(format: "podcast" | "lecture"): CastVoices {
  if (format === "lecture") return { lecturer: { voice: NARRATION_VOICE, rate: 1 } };
  return {
    host: { voice: NARRATION_VOICE, rate: 1 },
    expert: { voice: EXPERT_VOICE, rate: 1 },
  };
}
