import Editor from "@monaco-editor/react";
import { ArrowLeft, Check, Lock, MessageCircleQuestion, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { KojoHelpChat } from "../components/KojoHelpChat";
import { MarkdownContent } from "../components/MarkdownContent";
import SimTimelinePanel from "../components/SimTimelinePanel";
import { exerciseId as buildExerciseId, getConcept, resolveMockPackages } from "../data/systemDesign";
import type { ExerciseKind } from "../data/systemDesign/types";
import { getSystemDesignSubmission, putSystemDesignSubmission } from "../lib/api";
import { runPythonMultiFile, type MultiFileTestResult } from "../lib/pyodideRunner";
import { useSettings } from "../lib/useSettings";

const AUTOSAVE_DELAY_MS = 800;
const EXERCISE_KINDS: ExerciseKind[] = ["visualizer", "project"];

type Pane = "brief" | "code" | "results";

export default function SystemDesignWorkspace() {
  const { conceptId, exerciseKind } = useParams<{ conceptId: string; exerciseKind: string }>();
  const { betaMode } = useSettings();
  const concept = getConcept(conceptId);
  const kind = EXERCISE_KINDS.find((candidate) => candidate === exerciseKind) ?? null;
  const exercise = concept && kind ? concept[kind] : null;

  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [result, setResult] = useState<MultiFileTestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [doneBanner, setDoneBanner] = useState(false);
  const [kojoOpen, setKojoOpen] = useState(false);
  // Which pane is showing on a narrow screen. Inert above the breakpoint, where
  // CSS shows all three at once, so no matchMedia listener is needed here.
  const [pane, setPane] = useState<Pane>("code");

  // The autosave timer reads the latest buffer through a ref so a burst of
  // keystrokes collapses into one PUT carrying every file, not just the tab
  // that happened to fire last.
  const filesRef = useRef(files);
  filesRef.current = files;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exerciseId = concept && kind ? buildExerciseId(concept.id, kind) : "";

  useEffect(() => {
    if (!exercise || !exerciseId) return;
    let cancelled = false;
    const starters: Record<string, string> = {};
    for (const file of exercise.files) starters[file.name] = file.contents;

    setHydrated(false);
    setResult(null);
    setDoneBanner(false);
    getSystemDesignSubmission(exerciseId)
      .then((submission) => {
        if (cancelled) return;
        // Only the editable files are restored from the server. A readonly file
        // is provided content: it must always match what the exercise ships.
        const restored = { ...starters };
        for (const file of exercise.files) {
          if (!file.readonly && submission.files?.[file.name] !== undefined) {
            restored[file.name] = submission.files[file.name];
          }
        }
        setFiles(restored);
      })
      .catch(() => {
        if (!cancelled) setFiles(starters);
      })
      .finally(() => {
        if (cancelled) return;
        setActiveFile(exercise.files.find((file) => !file.readonly)?.name ?? exercise.files[0].name);
        setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [exercise, exerciseId]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const scheduleAutosave = useCallback(() => {
    if (!exerciseId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      putSystemDesignSubmission(exerciseId, filesRef.current, false)
        .then(() => setAutosaveError(null))
        // The buffer is never reset on a failed save: losing what the learner
        // typed because the network blipped would be far worse than a warning.
        .catch(() => setAutosaveError("Could not save your work. Your code is still here, retrying on the next edit."));
    }, AUTOSAVE_DELAY_MS);
  }, [exerciseId]);

  const handleChange = useCallback(
    (name: string, value: string) => {
      setFiles((previous) => ({ ...previous, [name]: value }));
      filesRef.current = { ...filesRef.current, [name]: value };
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  const runExercise = useCallback(async (): Promise<MultiFileTestResult | null> => {
    if (!exercise) return null;
    setRunning(true);
    setDoneBanner(false);
    setPane("results");
    try {
      const runResult = await runPythonMultiFile({
        files: filesRef.current,
        testModule: exercise.testModule,
        mockPackages: resolveMockPackages(exercise.mockPackages),
      });
      setResult(runResult);
      return runResult;
    } finally {
      setRunning(false);
    }
  }, [exercise]);

  const handleDone = useCallback(async () => {
    const runResult = await runExercise();
    if (!runResult?.ok || !exerciseId) return;
    try {
      await putSystemDesignSubmission(exerciseId, filesRef.current, true);
      setDoneBanner(true);
      setAutosaveError(null);
    } catch {
      setAutosaveError("Your tests passed but the result could not be saved. Try Done again.");
    }
  }, [exerciseId, runExercise]);

  const activeConceptFile = useMemo(
    () => exercise?.files.find((file) => file.name === activeFile) ?? null,
    [activeFile, exercise],
  );

  if (!betaMode) return <Navigate to="/leetcode" replace />;
  if (!concept) return <Navigate to="/system-design" replace />;
  if (!kind || !exercise) return <Navigate to={`/system-design/${concept.id}`} replace />;

  const failing = result?.cases.filter((testCase) => !testCase.passed) ?? [];
  const passing = result?.cases.filter((testCase) => testCase.passed) ?? [];
  const hasResult = running || result !== null;

  return (
    <div className="sd-workspace">
      <header className="sd-workspace-bar">
        <Link
          className="flash-back-btn"
          to={`/system-design/${concept.id}`}
          aria-label={`Back to ${concept.title}`}
          title={`Back to ${concept.title}`}
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="sd-workspace-title">
          <span className="eyebrow">{concept.title}</span>
          <h1>{exercise.title}</h1>
        </div>
        <div className="sd-workspace-actions">
          <button type="button" className="sd-audio-btn" onClick={() => setKojoOpen(true)}>
            <MessageCircleQuestion size={14} />
            Ask Kojo
          </button>
          <button
            type="button"
            className={`button button-${result?.ok ? "secondary" : "primary"} sd-action-btn`}
            onClick={() => void runExercise()}
            disabled={running || !hydrated}
          >
            <Play size={16} />
            Run
          </button>
          <button
            type="button"
            className={`button button-${result?.ok ? "primary" : "secondary"} sd-action-btn`}
            onClick={() => void handleDone()}
            disabled={running || !hydrated}
          >
            <Check size={16} />
            Done
          </button>
        </div>
      </header>

      {autosaveError ? (
        <div className="sd-banner sd-banner--warn" data-testid="sd-autosave-warning" role="status">
          {autosaveError}
        </div>
      ) : null}

      {doneBanner ? (
        <div className="sd-banner sd-banner--done" data-testid="sd-done-banner" role="status">
          Passed. This sub-module is marked done.{" "}
          <Link to={`/system-design/${concept.id}`}>Back to {concept.title}</Link>
        </div>
      ) : null}

      {/* Narrow screens show one pane at a time. Hidden by CSS above the
          breakpoint, where all three panes are on screen together. */}
      <div className="sd-pane-switch" role="tablist" aria-label="Workspace panes">
        {(["brief", "code", "results"] as Pane[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={pane === name}
            className={`sd-pane-tab${pane === name ? " is-active" : ""}`}
            onClick={() => setPane(name)}
            disabled={name === "results" && !hasResult}
          >
            {name === "brief" ? "Brief" : name === "code" ? "Code" : "Results"}
          </button>
        ))}
      </div>

      <div className="sd-workspace-body" data-pane={pane} data-has-result={hasResult ? "true" : "false"}>
        <section className="sd-brief">
          <MarkdownContent content={exercise.brief} enableCodeCopy />
          {exercise.simGuide ? (
            <div className="sd-sim-guide">
              <h2 className="sd-sim-guide-title">Instrumentation</h2>
              <MarkdownContent content={exercise.simGuide} />
            </div>
          ) : null}
        </section>

        <section className="sd-editor-pane">
          <div className="sd-file-tabs" role="tablist" aria-label="Exercise files">
            {exercise.files.map((file) => (
              <button
                key={file.name}
                type="button"
                role="tab"
                aria-selected={file.name === activeFile}
                className={`sd-file-tab${file.name === activeFile ? " is-active" : ""}`}
                data-testid="sd-file-tab"
                data-file={file.name}
                data-readonly={file.readonly ? "true" : "false"}
                onClick={() => setActiveFile(file.name)}
              >
                {file.readonly ? <Lock size={12} /> : null}
                {file.name}
                {file.readonly ? <span className="sd-file-tab-note">read only</span> : null}
              </button>
            ))}
          </div>

          <div className="sd-editor-surface">
            {hydrated ? (
              <Editor
                height="100%"
                defaultLanguage="python"
                // One Monaco model per file via `path`, seeded with
                // `defaultValue` rather than a controlled `value`: a controlled
                // value replaces the whole document whenever the prop lags the
                // live buffer, which snaps the caret to the end of the file.
                path={`${exerciseId}:${activeFile}`}
                defaultValue={files[activeFile] ?? ""}
                onChange={(value) => handleChange(activeFile, value ?? "")}
                theme="vs-dark"
                options={{
                  readOnly: Boolean(activeConceptFile?.readonly),
                  automaticLayout: true,
                  fontSize: 14,
                  fontFamily:
                    "Menlo, Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', 'Courier New', monospace",
                  minimap: { enabled: false },
                  // The editor shares the width with a brief and a results
                  // panel, so long lines wrap instead of being clipped off the
                  // right edge with no scrollbar in sight.
                  wordWrap: "on",
                  quickSuggestions: true,
                  suggestOnTriggerCharacters: false,
                  parameterHints: { enabled: false },
                  wordBasedSuggestions: "currentDocument",
                  tabSize: 4,
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  padding: { top: 16, bottom: 16 },
                }}
              />
            ) : (
              <div className="sd-skeleton">Loading your workspace...</div>
            )}
          </div>
        </section>

        <section className="sd-results" aria-live="polite">
          {running ? <div className="sd-skeleton">Running your code...</div> : null}

          {!running && !result ? (
            <p className="muted small sd-results-empty">
              Run your code to see the test cases and the timeline of what it did.
            </p>
          ) : null}

          {result?.error ? (
            <div className="sd-run-error" data-testid="sd-run-error">
              <h2 className="sd-results-title">Your code did not run</h2>
              <p className="small muted">
                Python could not load your files, so no tests were reached. Fix this first.
              </p>
              <pre>{result.error}</pre>
            </div>
          ) : null}

          {result && !result.error ? (
            <>
              <div className={`sd-result-summary${result.ok ? " is-pass" : " is-fail"}`}>
                {result.ok ? (
                  <>
                    <Check size={16} />
                    All {result.cases.length} cases passed. Press Done to record it.
                  </>
                ) : (
                  <>
                    <X size={16} />
                    {failing.length} of {result.cases.length} cases failing.
                  </>
                )}
              </div>

              {/* On a green run the summary above says everything, so the ten
                  identical rows fold away and the timeline gets the space. */}
              <details className="sd-case-details" open={!result.ok}>
                <summary>
                  {result.ok ? `Show all ${result.cases.length} cases` : "Test cases"}
                </summary>
                <ul className="sd-case-list" data-testid="sd-case-list">
                  {/* Failures first: they are the only rows worth reading closely. */}
                  {[...failing, ...passing].map((testCase) => (
                    <li
                      key={testCase.name}
                      className={`sd-case${testCase.passed ? " is-pass" : " is-fail"}`}
                      data-passed={testCase.passed ? "true" : "false"}
                    >
                      {testCase.passed ? <Check size={14} /> : <X size={14} />}
                      <span className="sd-case-name">{testCase.name}</span>
                      {testCase.message ? (
                        <span className="sd-case-message">{testCase.message}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>

              {result.stdout.trim() ? (
                <div className="sd-stdout" data-testid="sd-stdout">
                  <h2 className="sd-results-title">Printed output</h2>
                  <pre>{result.stdout}</pre>
                </div>
              ) : null}

              <h2 className="sd-results-title">Timeline</h2>
              <SimTimelinePanel events={result.events} />
            </>
          ) : null}
        </section>
      </div>

      {kojoOpen ? (
        <KojoHelpChat
          storageKey={`sd:${exerciseId}`}
          subtitle={`${concept.title}: ${exercise.title}`}
          onClose={() => setKojoOpen(false)}
          buildContext={() =>
            [
              `System Design exercise: ${concept.title} / ${exercise.title}`,
              "BRIEF:",
              exercise.brief,
              `CURRENT FILE (${activeFile}):`,
              filesRef.current[activeFile] ?? "",
            ].join("\n\n")
          }
          customInstruction="Give hints and explain the concept. Never write the learner's implementation for them."
          contractNote="Kojo gives hints for this exercise, never the finished code."
        />
      ) : null}
    </div>
  );
}
