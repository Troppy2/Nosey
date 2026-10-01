import type { Alignment, Side } from "driver.js";
import type { TourId } from "../../lib/api";

export type TourStep = {
  /** `[data-tour]` selector. Steps whose target is not on screen are skipped. */
  element?: string;
  title: string;
  body: string;
  side?: Side;
  align?: Alignment;
  /**
   * Wait for the user to click `element` instead of showing Next. Ends the
   * current segment; the steps after it are measured once the click lands.
   */
  action?: boolean;
  /** Skip this step when this selector is on screen (e.g. the panel is already open). */
  skipIf?: string;
};

export type TourDef = {
  steps: TourStep[];
  /** Kojo needs an account, so guests never get its tour. */
  signedInOnly?: boolean;
};

const t = (name: string) => `[data-tour="${name}"]`;

// Every claim here was checked against the code it describes. Keep it that
// way: the practice run once shipped a line about flashcards that was false.
export const TOURS: Record<TourId, TourDef> = {
  folders: {
    steps: [
      {
        element: t("folders-header"),
        title: "One folder per class",
        body: "A folder holds everything for one class: your notes, the practice tests made from them, and your flashcards.",
        side: "bottom",
        align: "start",
      },
      {
        element: `${t("folders-list")} > :first-child`,
        title: "Open a folder",
        body: "Click any folder to see its notes, tests, and flashcards in one place.",
        side: "bottom",
        align: "start",
      },
      {
        element: t("folders-new"),
        title: "Make your first folder",
        body: "Click New Folder and name it after a class.",
        side: "bottom",
        align: "end",
        action: true,
      },
    ],
  },

  "folder-detail": {
    steps: [
      {
        element: t("folder-notes"),
        title: "Your notes live here",
        body: "Upload lecture notes, slides, or readings once. Tests, flashcards, and Kojo in this folder can all use them.",
        side: "bottom",
      },
      {
        element: t("folder-new-test"),
        title: "Make a practice test",
        body: "Turn this folder's notes into questions to practice with.",
        side: "bottom",
        align: "end",
      },
      {
        element: t("folder-flashcards"),
        title: "Flashcards",
        body: "Generate cards from your notes or write your own.",
        side: "bottom",
      },
      {
        element: t("folder-settings"),
        title: "Folder settings",
        body: "Choose whether Kojo reads this folder's notes in Chat by default, and whether it can make tests and flashcards from them.",
        side: "bottom",
      },
      {
        element: t("folder-tests"),
        title: "Your tests",
        body: "Every test you make shows up here. Open one to take it again or look back at past attempts.",
        side: "top",
        align: "start",
      },
    ],
  },

  "create-test": {
    steps: [
      {
        element: t("create-type"),
        title: "Pick a test type",
        body: "Multiple choice, written answers (graded for you), or a mix. Extreme is multiple choice at the hardest level, with no simple recall questions.",
        side: "bottom",
      },
      {
        element: t("create-mode"),
        title: "STEM and Coding modes",
        body: "STEM mode writes calculation problems with step-by-step solutions. Coding mode gives you a code editor and grades your code. Leave both off for any other subject.",
        side: "bottom",
      },
      {
        element: t("create-advanced"),
        title: "Want more control?",
        body: "Click Advanced mode to set difficulty, question counts, and your own instructions.",
        side: "bottom",
        align: "end",
        action: true,
        skipIf: t("create-advanced-panel"),
      },
      {
        element: t("create-difficulty"),
        title: "Difficulty",
        body: "Easy, medium, or hard, or keep Mixed for a spread.",
        side: "bottom",
      },
      {
        element: t("create-topic"),
        title: "Topic focus",
        body: "Narrow the questions to one topic in your notes, like \"chapter 3\" or \"photosynthesis\".",
        side: "bottom",
      },
      {
        element: t("create-instructions"),
        title: "Custom instructions",
        body: "Tell Nosey exactly what you want, in plain words. These win over topic focus when you set both.",
        side: "top",
      },
      {
        element: t("create-counts"),
        title: "Question counts",
        body: "Choose exactly how many multiple choice and written questions you get, up to 50 each.",
        side: "top",
      },
      {
        element: t("create-practice"),
        title: "Have an old exam?",
        body: "Upload a practice test and Nosey recreates its questions.",
        side: "top",
      },
      {
        element: t("create-editor"),
        title: "Question editor mode",
        body: "Turn this on to review and edit the questions before you take the test.",
        side: "top",
        align: "start",
      },
      {
        element: t("create-upload"),
        title: "Add your notes",
        body: "Drop files here. If the folder already has saved notes, Nosey uses those too, so this can stay empty.",
        side: "top",
      },
      {
        element: t("create-generate"),
        title: "Generate",
        body: "Once your notes finish uploading you can leave. The test keeps building in its folder.",
        side: "top",
        align: "end",
      },
    ],
  },

  "learning-modes": {
    steps: [
      {
        element: t("mode-flashcards"),
        title: "Flashcards",
        body: "Flip through cards one at a time and rate how well you knew each one.",
        side: "bottom",
      },
      {
        element: t("mode-matching"),
        title: "Matching",
        body: "Race the clock to pair each term with its definition.",
        side: "bottom",
      },
      {
        element: t("modes-empty"),
        title: "No cards yet",
        body: "Open this folder and use Manage Flashcards to generate cards from your notes.",
        side: "top",
      },
    ],
  },

  "flashcard-review": {
    steps: [
      {
        element: t("review-card"),
        title: "Answer it in your head",
        body: "Then tap the card to flip it and check.",
        side: "bottom",
        action: true,
        skipIf: t("review-confidence"),
      },
      {
        element: t("review-confidence"),
        title: "Rate yourself",
        body: "Cards you keep missing move up in difficulty, and the hardest ones show up on your dashboard for review.",
        side: "top",
      },
      {
        element: t("review-nav"),
        title: "Skip around",
        body: "The arrows move between cards without rating them.",
        side: "top",
      },
    ],
  },

  matching: {
    steps: [
      {
        element: t("match-decks"),
        title: "Pick what to drill",
        body: "Cards you keep missing, ones you have not tried yet, the whole class, or a set you choose yourself.",
        side: "bottom",
      },
      {
        element: t("match-size"),
        title: "Board size",
        body: "How many pairs are on the board each round.",
        side: "top",
      },
      {
        element: t("match-start"),
        title: "Go",
        body: "Clear the board as fast as you can. Every round is timed.",
        side: "top",
        align: "start",
      },
    ],
  },

  "manage-flashcards": {
    steps: [
      {
        element: t("manage-generate"),
        title: "Generate with AI",
        body: "Nosey writes cards from the notes saved in this folder.",
        side: "bottom",
      },
      {
        element: t("manage-from-file"),
        title: "From one file",
        body: "Pick a file to make cards from just that file.",
        side: "bottom",
      },
      {
        element: t("manage-more"),
        title: "Generate more",
        body: "Set how many cards to add and Nosey writes new ones, skipping any you already have.",
        side: "bottom",
      },
      {
        element: t("manage-add"),
        title: "Write your own",
        body: "Add cards by hand whenever you want.",
        side: "top",
      },
    ],
  },

  kojo: {
    signedInOnly: true,
    steps: [
      {
        element: t("kojo-composer"),
        title: "Meet Kojo",
        body: "Ask anything you are stuck on. In general chat Kojo answers from what it knows. In a folder chat it answers from that folder's notes.",
        side: "top",
      },
      {
        element: t("kojo-folders"),
        title: "Chat about a class",
        body: "Open a folder here and Kojo answers from that folder's notes.",
        side: "right",
      },
      {
        element: t("kojo-menu"),
        title: "Chat about a class",
        body: "Open the menu to pick a folder. Kojo then answers from that folder's notes.",
        side: "bottom",
        align: "start",
      },
      {
        element: t("kojo-docs"),
        title: "Docs",
        body: "Files in this chat, and anything Kojo makes for you, are kept here.",
        side: "bottom",
        align: "end",
      },
      {
        element: t("kojo-attach"),
        title: "Add your notes",
        body: "Click + to attach files to this chat.",
        side: "top",
        align: "start",
        action: true,
      },
    ],
  },
};
