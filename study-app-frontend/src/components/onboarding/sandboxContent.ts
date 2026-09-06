// Fixed content for the first-run practice run.
//
// Nothing here touches the API. The walkthrough is a rehearsal: the user drives
// a miniature Nosey built from this data, so every run is identical, works
// offline, works for guests, and cannot leave a stray folder or test behind in
// a real account. The subject was chosen to be legible to anyone regardless of
// major, and the questions are written the way the real generator writes them
// (one recall MCQ, one applied free response) so the rehearsal is honest about
// what the product actually produces.

export type SandboxNote = {
  id: string;
  name: string;
  meta: string;
  /** Shown as the extracted preview once the file is attached. */
  excerpt: string;
};

export const SANDBOX_FOLDER_NAME = "PSYC 101";

export const SANDBOX_NOTES: SandboxNote[] = [
  {
    id: "lecture-4",
    name: "Lecture 4 - Memory.pdf",
    meta: "PDF, 11 pages",
    excerpt:
      "Encoding turns experience into a storable trace. Depth matters more than repetition: judging what a word means produces far better recall than judging how it looks or sounds. Retrieval then depends on the overlap between the cues present now and the cues present at encoding.",
  },
  {
    id: "seminar",
    name: "Seminar notes - week 4.docx",
    meta: "Word, 3 pages",
    excerpt:
      "Discussion of encoding specificity, state-dependent recall, and why cramming produces confident but fragile memories.",
  },
];

export type SandboxMcq = {
  kind: "mcq";
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type SandboxFrq = {
  kind: "frq";
  prompt: string;
  sampleAnswer: string;
  feedback: string;
};

export type SandboxQuestion = SandboxMcq | SandboxFrq;

// Titles shown one at a time while the generator "streams", mirroring the real
// streamed generation the user will see on their own notes.
export const SANDBOX_STREAM_TITLES = [
  "Levels of processing",
  "Encoding specificity",
  "Retrieval cues in practice",
  "Spacing and durability",
  "Applying encoding specificity",
];

export const SANDBOX_QUESTIONS: SandboxQuestion[] = [
  {
    kind: "mcq",
    prompt:
      "Your notes say deeper encoding produces better recall. Which task encodes a word most deeply?",
    options: [
      "Counting the letters in the word",
      "Deciding whether the word rhymes with another word",
      "Deciding whether the word describes something you have done",
      "Reading the word aloud five times in a row",
    ],
    correctIndex: 2,
    explanation:
      "Relating a word to your own experience is semantic, self-referential processing, the deepest level in the notes. Counting letters is visual, rhyming is acoustic, and repetition alone adds no depth at all.",
  },
  {
    kind: "frq",
    prompt:
      "A student revises for an exam in a noisy cafe and sits the exam in a silent hall. Using encoding specificity, explain why their recall may suffer.",
    sampleAnswer:
      "Encoding specificity says retrieval works best when the cues at recall match the cues at encoding. The cafe noise became part of the encoded context, so the silent hall removes those cues and leaves fewer routes back to the memory.",
    feedback:
      "Strong. You named the principle, tied it to the mismatch between the two settings, and said what the mismatch costs at retrieval. A full-credit answer would add one fix, such as revising in conditions closer to the exam room.",
  },
];
