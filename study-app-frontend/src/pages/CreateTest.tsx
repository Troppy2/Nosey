import { ArrowLeft, Atom, Calculator, Code2, FileText, Settings2, Upload } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { SelectInput, TextInput } from "../components/Field";
import { InlineLoading, LoadingNotice } from "../components/Loaders";
import { createTest, fetchFolderFiles, fetchFolders, fetchProviderStatus, scopeKey, type SkippedFile } from "../lib/api";
import {
  ACCEPTED_UPLOAD_ATTR,
  MAX_FOLDER_UPLOAD_MB,
  MAX_UPLOAD_FILE_SIZE_MB,
  isAcceptedUpload,
  uploadToFolder,
} from "../lib/folderUploads";
import { useSettings } from "../lib/useSettings";
import { toast } from "../lib/toast";
import { usePageTour } from "../components/tours/usePageTour";
import type { Folder, ProviderStatus, TestCreationParams } from "../lib/types";

// Matches _CUSTOM_INSTRUCTIONS_MAX in study-app-backend/src/routes/tests.py.
const CUSTOM_INSTRUCTIONS_MAX = 10_000;

export default function CreateTest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [titleCleared, setTitleCleared] = useState(false);
  const [testType, setTestType] = useState("mixed");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // What the submit is waiting on right now, shown in the loading notice.
  const [submitPhase, setSubmitPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Advanced mode state
  const [advancedMode, setAdvancedMode] = useState(false);
  const [countMcq, setCountMcq] = useState(10);
  const [countFrq, setCountFrq] = useState(5);
  // Extra (beta) question types
  const [countTf, setCountTf] = useState(0);
  const [countMs, setCountMs] = useState(0);
  const [countRank, setCountRank] = useState(0);
  const [reviewBeforeTaking, setReviewBeforeTaking] = useState(false);
  const [practiceTestFile, setPracticeTestFile] = useState<File | null>(null);
  const [practiceTestMode, setPracticeTestMode] = useState<"recreate" | "style">("recreate");
  const practiceTestInputRef = useRef<HTMLInputElement>(null);
  const [isMathMode, setIsMathMode] = useState(false);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [topicFocus, setTopicFocus] = useState("");
  const [isCodingMode, setIsCodingMode] = useState(false);
  const [codingLanguage, setCodingLanguage] = useState("Python");
  const [customInstructions, setCustomInstructions] = useState("");
  const { generationProvider, betaMode } = useSettings();

  function countWords(text: string) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
  const [folderFileCount, setFolderFileCount] = useState(0);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);

  useEffect(() => {
    fetchFolders().then((data) => {
      setFolders(data);
      const requestedFolderId = Number(searchParams.get("folderId"));
      const nextFolderId =
        data.find((folder) => folder.id === requestedFolderId)?.id ?? data[0]?.id ?? null;
      setFolderId(nextFolderId);

      // Restore form state from localStorage
      const regenerateTestId = Number(searchParams.get("regenerateTestId")) || null;
      const storageKey = regenerateTestId
        ? `nosey_test_params_${regenerateTestId}`
        : nextFolderId
          ? `nosey_create_test_form_${nextFolderId}`
          : null;
      if (storageKey) {
        try {
          const raw = localStorage.getItem(scopeKey(storageKey));
          if (raw) {
            const p = JSON.parse(raw) as Partial<TestCreationParams>;
            if (p.title !== undefined) setTitle(p.title);
            if (p.testType) setTestType(p.testType);
            if (p.countMcq !== undefined) setCountMcq(p.countMcq);
            if (p.countFrq !== undefined) setCountFrq(p.countFrq);
            if (p.countTf !== undefined) setCountTf(p.countTf);
            if (p.countMs !== undefined) setCountMs(p.countMs);
            if (p.countRank !== undefined) setCountRank(p.countRank);
            if (p.isMathMode !== undefined) setIsMathMode(p.isMathMode);
            if (p.isCodingMode !== undefined) setIsCodingMode(p.isCodingMode);
            if (p.codingLanguage) setCodingLanguage(p.codingLanguage);
            if (p.difficulty) setDifficulty(p.difficulty);
            if (p.topicFocus !== undefined) setTopicFocus(p.topicFocus);
            if (p.customInstructions !== undefined) setCustomInstructions(p.customInstructions);
            if (p.advancedMode !== undefined) setAdvancedMode(p.advancedMode);
          }
        } catch {
          // ignore malformed draft
        }
      }
    });
  }, [searchParams]);

  useEffect(() => {
    if (!folderId) return;
    let active = true;
    fetchFolderFiles(folderId).then((files) => {
      if (active) setFolderFileCount(files.length);
    });
    return () => {
      active = false;
    };
  }, [folderId]);

  useEffect(() => {
    fetchProviderStatus().then(setProviderStatus).catch(() => {});
  }, []);

  // Persist form state to localStorage while the user fills in the form
  useEffect(() => {
    if (!folderId) return;
    if (!title.trim() && !topicFocus.trim() && !customInstructions.trim()) return;
    const draft: TestCreationParams = {
      title, folderId, testType, countMcq, countFrq,
      countTf, countMs, countRank,
      isMathMode, isCodingMode, codingLanguage, difficulty,
      topicFocus, customInstructions, advancedMode,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(scopeKey(`nosey_create_test_form_${folderId}`), JSON.stringify(draft));
  }, [title, folderId, testType, countMcq, countFrq, countTf, countMs, countRank, isMathMode, isCodingMode, codingLanguage, difficulty, topicFocus, customInstructions, advancedMode]);

  // If the user's saved provider is currently unavailable, fall back to "auto" for THIS
  // request only. Do not rewrite the shared `nosey_generation_provider` setting: it is read
  // by Kojo chat, flashcards and LeetCode too, so overwriting it here would silently override
  // the user's chosen LLM app-wide. The backend already falls back across providers for a
  // specific pick, so sending "auto" here is just a frontend convenience, not a hard requirement.
  const providerUnavailable =
    !!providerStatus &&
    ((generationProvider === "groq" && !providerStatus.groq) ||
      (generationProvider === "gemini" && !providerStatus.gemini) ||
      (generationProvider === "claude" && !providerStatus.claude) ||
      (generationProvider === "minimax" && !providerStatus.minimax) ||
      (generationProvider === "ollama" && !providerStatus.ollama));
  const effectiveProvider = providerUnavailable ? "auto" : generationProvider;

  // The practice test only counts in Advanced mode, where its control lives.
  const activePracticeTest = advancedMode ? practiceTestFile : null;
  // Both modes work without notes: a parallel version falls back to the exam's
  // own topics when the notes don't cover them.
  const recreatingPracticeTest = activePracticeTest !== null && practiceTestMode === "recreate";

  function describeSkipped(skipped: SkippedFile[]): string {
    return skipped.map((s) => `${s.file_name}: ${s.reason}`).join(" · ");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!folderId) return;
    const resolvedTitle = title.trim() || "Untitled Test";
    setIsSubmitting(true);
    setError(null);
    try {
      // Files go through the folder upload pipeline first (per-file status,
      // page batching, duplicate check), then the test is created from their
      // ids. The server waits for their text, so this returns once bytes land.
      let fileIds: number[] | undefined;
      let skippedNotes: SkippedFile[] = [];
      if (files.length > 0 && !recreatingPracticeTest) {
        const upload = await uploadToFolder(folderId, files, (done, total) =>
          setSubmitPhase(
            total > 1 ? `Uploading your notes (${Math.min(done + 1, total)} of ${total})` : "Uploading your notes",
          ),
        );
        if (upload.fileIds.length === 0) throw new Error(describeSkipped(upload.skipped));
        fileIds = upload.fileIds;
        skippedNotes = upload.skipped;
      }
      let practiceTestFileId: number | undefined;
      if (activePracticeTest) {
        setSubmitPhase("Uploading your practice test");
        const upload = await uploadToFolder(folderId, [activePracticeTest]);
        if (upload.fileIds.length === 0) throw new Error(describeSkipped(upload.skipped));
        practiceTestFileId = upload.fileIds[0];
      }
      setSubmitPhase("Setting up your test");
      const result = await createTest({
        folderId,
        title: resolvedTitle,
        testType,
        fileIds,
        practiceTestFileId,
        practiceTestMode: activePracticeTest ? (recreatingPracticeTest ? "recreate" : "style") : undefined,
        countMcq: advancedMode ? countMcq : undefined,
        countFrq: advancedMode ? (testType === "Extreme" ? 0 : countFrq) : undefined,
        countTf: advancedMode && betaMode ? countTf : undefined,
        countMs: advancedMode && betaMode ? countMs : undefined,
        countRank: advancedMode && betaMode ? countRank : undefined,
        isMathMode: isMathMode && !isCodingMode,
        isCodingMode,
        codingLanguage: isCodingMode ? codingLanguage : undefined,
        difficulty: advancedMode ? difficulty : undefined,
        topicFocus: advancedMode && topicFocus.trim() ? topicFocus.trim() : undefined,
        customInstructions: advancedMode && customInstructions.trim() ? customInstructions.trim() : undefined,
        generationProvider: effectiveProvider,
        enableFallback: localStorage.getItem(scopeKey("nosey_question_fallback")) === "true",
      });
      sessionStorage.setItem(
        `nosey_generation_meta_${result.test_id}`,
        JSON.stringify({
          fallback_used: result.fallback_used,
          fallback_reason: result.fallback_reason,
          note_grounded: result.note_grounded,
          retrieval_enabled: result.retrieval_enabled,
          retrieval_total_chunks: result.retrieval_total_chunks,
          retrieval_selected_chunks: result.retrieval_selected_chunks,
          retrieval_top_k: result.retrieval_top_k,
        }),
      );
      // Save creation params so FolderDetail can show the prompt later
      if (folderId) {
        const params: TestCreationParams = {
          title: resolvedTitle, folderId, testType, countMcq, countFrq,
          countTf, countMs, countRank,
          isMathMode, isCodingMode, codingLanguage, difficulty,
          topicFocus, customInstructions, advancedMode,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(scopeKey(`nosey_test_params_${result.test_id}`), JSON.stringify(params));
        localStorage.removeItem(scopeKey(`nosey_create_test_form_${folderId}`));
      }
      if (skippedNotes.length > 0) {
        toast.error("Some files were not added", describeSkipped(skippedNotes));
      }
      // Generation runs in the background. Land back in the folder (the original
      // flow) instead of a dead-end loading screen: the folder polls and opens the
      // test for taking as soon as the first questions are ready. Question editor
      // mode goes straight to the editor, which waits for generation itself. Only
      // a test that is already fully ready (rare fast path) opens straight away.
      if (advancedMode && reviewBeforeTaking) {
        navigate(`/test/${result.test_id}/edit`);
      } else if (result.generation_status === "ready") {
        toast.success("Practice test ready");
        navigate(`/test/${result.test_id}`);
      } else {
        // Still generating: FolderDetail's poll raises the completion toast once
        // it flips to ready or failed.
        navigate(`/folders/${folderId}`);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create that practice test.");
    } finally {
      setIsSubmitting(false);
      setSubmitPhase(null);
    }
  }

  function isUploadable(file: File) {
    return isAcceptedUpload(file) && file.size <= MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
  }

  function acceptFiles(nextFiles?: FileList | File[]) {
    if (!nextFiles || nextFiles.length === 0) return;
    const all = Array.from(nextFiles);
    const selected = all.filter(isUploadable);
    if (selected.length === 0) {
      setError(`Upload PDF, DOCX, PPTX, TXT, Markdown, or code files up to ${MAX_UPLOAD_FILE_SIZE_MB} MB each.`);
      return;
    }
    setError(
      selected.length < all.length
        ? `Skipped ${all.length - selected.length} file${all.length - selected.length === 1 ? "" : "s"}: unsupported type or over ${MAX_UPLOAD_FILE_SIZE_MB} MB.`
        : null,
    );
    setFiles((current) => {
      const merged = [...current, ...selected];
      const totalBytes = merged.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_FOLDER_UPLOAD_MB * 1024 * 1024) {
        setError(`A folder holds up to ${MAX_FOLDER_UPLOAD_MB} MB of files. Remove a file and try again.`);
        return current;
      }
      if (!title && merged[0]) setTitle(merged[0].name.replace(/\.[^/.]+$/, ""));
      return merged;
    });
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  function acceptPracticeTestFile(file?: File) {
    if (!file) return;
    if (!isUploadable(file)) {
      setError(`Practice test must be a PDF, DOCX, PPTX, TXT, Markdown, or code file up to ${MAX_UPLOAD_FILE_SIZE_MB} MB.`);
      return;
    }
    setError(null);
    setPracticeTestFile(file);
    if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ""));
  }

  const canSubmit =
    folderId !== null &&
    !isSubmitting &&
    (files.length > 0 || activePracticeTest !== null || folderFileCount > 0);

  usePageTour("create-test", folders.length > 0);

  return (
    <div className="page page-narrow">
      <Link className="back-link" to={folderId ? `/folders/${folderId}` : "/folders"}>
        <ArrowLeft size={16} />
        Folder
      </Link>
      <header className="page-header">
        <div>
          <h1>Create a practice test</h1>
          <p className="muted">
            Upload notes ({MAX_UPLOAD_FILE_SIZE_MB} MB each), or use files already saved in the folder, and choose the question style Nosey should generate.
          </p>
        </div>
        <button
          type="button"
          data-tour="create-advanced"
          className={`choice ${advancedMode ? "active" : ""}`}
          style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          onClick={() => setAdvancedMode((v) => !v)}
        >
          <Settings2 size={15} />
          Advanced mode
        </button>
      </header>

      <FormError message={error} />

      {folders.length === 0 ? (
        <EmptyState
          icon={<Upload />}
          title="Create a folder first"
          body="You need at least one folder before you can generate a practice test."
          action={
            <Link to="/folders">
              <Button>Go to Folders</Button>
            </Link>
          }
        />
      ) : (
        <form className="create-form" onSubmit={handleSubmit}>
          <Card className="form-panel">
            <TextInput
              label="Test title"
              value={title || (titleCleared ? "" : "Untitled Test")}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!e.target.value) setTitleCleared(true);
              }}
              placeholder="Midterm Practice"
            />
            <SelectInput
              label="Folder"
              value={folderId ?? ""}
              onChange={(e) => setFolderId(Number(e.target.value))}
            >
              <option value="" disabled>
                Select a folder
              </option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </SelectInput>
            <p className="muted small" style={{ marginTop: -8 }}>
              {folderFileCount > 0
                ? `${folderFileCount} saved file${folderFileCount === 1 ? "" : "s"} available in this folder.`
                : "No saved files in this folder yet. You can still upload new documents here."}
            </p>

            <div data-tour="create-type" className="field">
              <span className="field-label">Test type</span>
              <div className="choice-grid">
                {[
                  ["MCQ_only", "Multiple choice"],
                  ["FRQ_only", "Written"],
                  ["mixed", "Mixed"],
                  ["Extreme", "Extreme"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={`choice ${testType === value ? "active" : ""}`}
                    onClick={() => setTestType(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div data-tour="create-mode" className="field">
              <span className="field-label">Mode</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className={`math-mode-toggle ${isMathMode && !isCodingMode ? "active" : ""}`}
                  onClick={() => { setIsMathMode((v) => !v); setIsCodingMode(false); }}
                >
                  <Atom size={16} />
                  <span>
                    <strong>STEM mode</strong>
                    <span className="math-mode-toggle-sub">
                      Generates calculation problems · LaTeX rendering · step-by-step explanations
                    </span>
                  </span>
                  <span className={`math-mode-pill ${isMathMode && !isCodingMode ? "on" : "off"}`}>
                    {isMathMode && !isCodingMode ? "On" : "Off"}
                  </span>
                </button>
                <button
                  type="button"
                  className={`math-mode-toggle ${isCodingMode ? "active" : ""}`}
                  onClick={() => { setIsCodingMode((v) => !v); setIsMathMode(false); }}
                >
                  <Code2 size={16} />
                  <span>
                    <strong>Coding mode</strong>
                    <span className="math-mode-toggle-sub">
                      CS practice problems · code editor · AI code review and grading
                    </span>
                  </span>
                  <span className={`math-mode-pill ${isCodingMode ? "on" : "off"}`}>
                    {isCodingMode ? "On" : "Off"}
                  </span>
                </button>
                {isCodingMode && (
                  <div className="field" style={{ marginTop: 4 }}>
                    <label className="field-label" htmlFor="coding-lang">Language</label>
                    <select
                      id="coding-lang"
                      className="input"
                      value={codingLanguage}
                      onChange={(e) => setCodingLanguage(e.target.value)}
                    >
                      {["Python", "JavaScript", "TypeScript", "Java", "C++", "C", "C#", "Go", "Rust", "Swift", "Kotlin", "OCaml", "SQL"].map((lang) => (
                        <option key={lang} value={lang}>{lang}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {advancedMode ? (
              <div className="settings-note" style={{ marginTop: 8 }}>
                <span>AI model override is managed in Settings.</span>
              </div>
            ) : null}
          </Card>

          {/* Advanced Mode panel */}
          {advancedMode && (
            <Card data-tour="create-advanced-panel" className="form-panel">
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                {/* Difficulty */}
                <div data-tour="create-difficulty">
                  <span className="eyebrow eyebrow-group">Difficulty</span>
                  <div className="choice-grid">
                    {(["easy", "medium", "hard", "mixed"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`choice ${difficulty === d ? "active" : ""}`}
                        onClick={() => setDifficulty(d)}
                        style={{ textTransform: "capitalize" }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Topic focus */}

                <div data-tour="create-topic" className="field">
                  <label className="field-label" htmlFor="topic-focus">
                    Topic focus <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    id="topic-focus"
                    type="text"
                    className="input"
                    placeholder="e.g. derivatives, Newton's laws, sorting algorithms…"
                    value={topicFocus}
                    onChange={(e) => setTopicFocus(e.target.value)}
                    maxLength={200}
                  />
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>
                    Focus questions on a specific topic within your notes.
                  </p>
                </div>

                {/* Custom instructions */}
                <div data-tour="create-instructions" className="field">
                  <label className="field-label" htmlFor="custom-instructions">
                    Custom instructions <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <textarea
                    id="custom-instructions"
                    className="input"
                    rows={6}
                    placeholder="e.g. Generate 5 word problems involving integration by parts, make all answer choices close in value, include at least 2 proof questions…"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    maxLength={CUSTOM_INSTRUCTIONS_MAX}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                  />
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.8rem" }}>
                    Natural language instructions that guide how questions are generated. Overrides topic focus when both are set.
                    <br />
                    {countWords(customInstructions)} word{countWords(customInstructions) !== 1 ? "s" : ""} used,{" "}
                    {customInstructions.length.toLocaleString()} / {CUSTOM_INSTRUCTIONS_MAX.toLocaleString()} characters.
                  </p>
                </div>

                {/* Question counts */}
                <div data-tour="create-counts">
                  <span className="eyebrow eyebrow-group">Question count</span>
                  {activePracticeTest ? (
                    <p className="muted small practice-mode-note practice-mode-note--above">
                      Not used with a practice test: you get one question for each question in it.
                    </p>
                  ) : null}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div className="field">
                      <label className="field-label" htmlFor="count-mcq">Multiple choice</label>
                      <input
                        id="count-mcq"
                        type="number"
                        min={0}
                        max={50}
                        value={countMcq}
                        onChange={(e) => setCountMcq(Math.max(0, Math.min(50, Number(e.target.value))))}
                        className="input"
                        disabled={testType === "FRQ_only"}
                        style={{ opacity: testType === "FRQ_only" ? 0.4 : 1 }}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="count-frq">Written</label>
                      <input
                        id="count-frq"
                        type="number"
                        min={0}
                        max={50}
                        value={countFrq}
                        onChange={(e) => setCountFrq(Math.max(0, Math.min(50, Number(e.target.value))))}
                        className="input"
                        disabled={testType === "MCQ_only" || testType === "Extreme"}
                        style={{ opacity: testType === "MCQ_only" || testType === "Extreme" ? 0.4 : 1 }}
                      />
                    </div>
                  </div>
                </div>

                {/* Extra question types (beta) */}
                {betaMode && (
                  <div className="extra-types-section">
                    <span className="eyebrow eyebrow-group eyebrow-group--described">
                      Extra question types <span className="pill pill--beta">Beta</span>
                    </span>
                    <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: "0.8rem" }}>
                      Added on top of your multiple choice and written counts. Generated separately, so they never block the rest of the test. Up to 10 each.
                    </p>
                    <div className="extra-types-grid">
                      <div className="field">
                        <label className="field-label" htmlFor="count-tf">True / False</label>
                        <input
                          id="count-tf"
                          type="number"
                          min={0}
                          max={10}
                          value={countTf}
                          onChange={(e) => setCountTf(Math.max(0, Math.min(10, Number(e.target.value))))}
                          className="input"
                        />
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor="count-ms">Multiple select</label>
                        <input
                          id="count-ms"
                          type="number"
                          min={0}
                          max={10}
                          value={countMs}
                          onChange={(e) => setCountMs(Math.max(0, Math.min(10, Number(e.target.value))))}
                          className="input"
                        />
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor="count-rank">Ranking</label>
                        <input
                          id="count-rank"
                          type="number"
                          min={0}
                          max={10}
                          value={countRank}
                          onChange={(e) => setCountRank(Math.max(0, Math.min(10, Number(e.target.value))))}
                          className="input"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Practice test upload */}
                <div data-tour="create-practice">
                  <span className="eyebrow eyebrow-group eyebrow-group--described">Upload practice test</span>
                  <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: "0.875rem" }}>
                    Upload an old exam or worksheet and Nosey rebuilds its questions so you can retake it. It is saved to this folder too.
                  </p>
                  {practiceTestFile ? (
                    <>
                      <div className="selected-file" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>
                          <FileText size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
                          {practiceTestFile.name} · {(practiceTestFile.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                        <button type="button" onClick={() => { setPracticeTestFile(null); if (practiceTestInputRef.current) practiceTestInputRef.current.value = ""; }}>
                          Remove
                        </button>
                      </div>
                      <div className="choice-grid practice-mode-grid" role="group" aria-label="What to do with the practice test">
                          <button
                            type="button"
                            className={`choice ${practiceTestMode === "recreate" ? "active" : ""}`}
                            aria-pressed={practiceTestMode === "recreate"}
                            onClick={() => setPracticeTestMode("recreate")}
                          >
                            Recreate its questions
                          </button>
                          <button
                            type="button"
                            className={`choice ${practiceTestMode === "style" ? "active" : ""}`}
                            aria-pressed={practiceTestMode === "style"}
                            onClick={() => setPracticeTestMode("style")}
                          >
                            Match its style
                          </button>
                      </div>
                      <p className="muted small practice-mode-note">
                        {recreatingPracticeTest
                          ? "Every question in the test is kept, with its answers. Where it has no answer key, Nosey works the answers out."
                          : "A new version of this test: each question gets a twin that tests the same skill in the same format, with new numbers or examples. Uses your notes when they cover the topic."}
                      </p>
                    </>
                  ) : (
                    <label
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
                        padding: "8px 14px", border: "1.5px dashed var(--green-light-mid)",
                        borderRadius: 8, fontSize: "0.875rem", color: "var(--green-dark)",
                        background: "var(--green-lightest)",
                      }}
                    >
                      <Upload size={14} />
                      Choose practice test file
                      <input
                        ref={practiceTestInputRef}
                        type="file"
                        accept={ACCEPTED_UPLOAD_ATTR}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          acceptPracticeTestFile(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Question editor mode */}
                <label data-tour="create-editor" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={reviewBeforeTaking}
                    onChange={(e) => setReviewBeforeTaking(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: "var(--green-dark)", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "0.9rem" }}>
                    <strong>Question editor mode</strong>: review and edit questions before taking the test
                  </span>
                </label>
              </div>
            </Card>
          )}

          <Card
            data-tour="create-upload"
            className={`upload-zone ${isDragging ? "dragging" : ""}`}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              acceptFiles(event.dataTransfer.files);
            }}
          >
            <input
              aria-label="Upload notes files"
              accept={ACCEPTED_UPLOAD_ATTR}
              multiple
              onChange={(event) => {
                acceptFiles(event.target.files ?? undefined);
                // Lets the same file be picked again after Remove.
                event.target.value = "";
              }}
              type="file"
            />
            {files.length > 0 ? (
              <>
                <FileText size={44} />
                <h2>
                  {files.length} document{files.length === 1 ? "" : "s"} selected
                </h2>
                <p>
                  {recreatingPracticeTest
                    ? "Not used while recreating a practice test."
                    : `Up to ${MAX_UPLOAD_FILE_SIZE_MB} MB each. They are saved to this folder when you generate.`}
                </p>
                <div className="selected-files">
                  {files.map((file, index) => (
                    <div className="selected-file" key={`${file.name}-${index}`}>
                      <span>
                        {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <button type="button" onClick={() => removeFile(index)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Upload size={44} />
                <h2>Drop notes here</h2>
                <p>PDF, DOCX, PPTX, TXT, Markdown, and code files. They are saved to this folder.</p>
              </>
            )}
          </Card>

          {/* The upload is the part the user waits on here: generation itself
              runs in the background and they land back in the folder. */}
          {isSubmitting ? (
            <LoadingNotice
              compact
              title={submitPhase ?? "Setting up your test"}
              estimate="Nosey reads your files and generates in the background, so you can leave once this finishes."
              slowNote="Still uploading. Large PDFs take a while. Keep this page open until it finishes."
              slowAfterMs={15000}
            />
          ) : null}

          <div className="button-row split">
            <Link to="/dashboard">
              <Button variant="secondary">Cancel</Button>
            </Link>
            <Button data-tour="create-generate" disabled={!canSubmit} type="submit">
              {isSubmitting ? <InlineLoading label="Generating" /> : "Generate Test"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
