import { ArrowLeft, Calculator, Code2, FileText, Settings2, Upload } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { SelectInput, TextInput } from "../components/Field";
import { createTest, fetchFolderFiles, fetchFolders, fetchProviderStatus } from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type { Folder, ProviderStatus } from "../lib/types";

const MAX_UPLOAD_FILE_SIZE_MB = 10;
const MAX_UPLOAD_TOTAL_SIZE_MB = 100;

export default function CreateTest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [testType, setTestType] = useState("mixed");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Advanced mode state
  const [advancedMode, setAdvancedMode] = useState(false);
  const [countMcq, setCountMcq] = useState(10);
  const [countFrq, setCountFrq] = useState(5);
  const [reviewBeforeTaking, setReviewBeforeTaking] = useState(false);
  const [practiceTestFile, setPracticeTestFile] = useState<File | null>(null);
  const practiceTestInputRef = useRef<HTMLInputElement>(null);
  const [isMathMode, setIsMathMode] = useState(false);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [topicFocus, setTopicFocus] = useState("");
  const [isCodingMode, setIsCodingMode] = useState(false);
  const [codingLanguage, setCodingLanguage] = useState("Python");
  const [customInstructions, setCustomInstructions] = useState("");
  const { generationProvider, setGenerationProvider } = useSettings();

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

  useEffect(() => {
    if (!providerStatus) return;
    const unavailable =
      (generationProvider === "groq" && !providerStatus.groq) ||
      (generationProvider === "gemini" && !providerStatus.gemini) ||
      (generationProvider === "claude" && !providerStatus.claude) ||
      (generationProvider === "ollama" && !providerStatus.ollama);
    if (unavailable) {
      setGenerationProvider("auto");
    }
  }, [providerStatus, generationProvider, setGenerationProvider]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !folderId) return;
    setIsSubmitting(true);
    try {
      const result = await createTest({
        folderId,
        title: title.trim(),
        testType,
        files,
        countMcq: advancedMode ? countMcq : undefined,
        countFrq: advancedMode ? (testType === "Extreme" ? 0 : countFrq) : undefined,
        practiceTestFile: advancedMode ? practiceTestFile : null,
        isMathMode: isMathMode && !isCodingMode,
        isCodingMode,
        codingLanguage: isCodingMode ? codingLanguage : undefined,
        difficulty: advancedMode ? difficulty : undefined,
        topicFocus: advancedMode && topicFocus.trim() ? topicFocus.trim() : undefined,
        customInstructions: advancedMode && customInstructions.trim() ? customInstructions.trim() : undefined,
        generationProvider: generationProvider,
        enableFallback: localStorage.getItem("nosey_question_fallback") !== "false",
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
      if (advancedMode && reviewBeforeTaking) {
        navigate(`/test/${result.test_id}/edit`);
      } else {
        navigate(`/test/${result.test_id}`);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create that practice test.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function acceptFiles(nextFiles?: FileList | File[]) {
    if (!nextFiles || nextFiles.length === 0) return;
    const selected = Array.from(nextFiles).filter((file) => {
      const allowedType =
        [
          "application/pdf",
          "text/plain",
          "text/markdown",
          "text/x-markdown",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ].includes(file.type) || /\.(pdf|docx|txt|md)$/i.test(file.name);
      return allowedType && file.size <= MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
    });
    if (selected.length === 0) {
      setError(`Upload PDF, DOCX, TXT, or Markdown documents under ${MAX_UPLOAD_FILE_SIZE_MB} MB each.`);
      return;
    }
    setError(null);
    setFiles((current) => {
      const merged = [...current, ...selected];
      const totalBytes = merged.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_UPLOAD_TOTAL_SIZE_MB * 1024 * 1024) {
        setError(`Combined uploads exceed ${MAX_UPLOAD_TOTAL_SIZE_MB} MB. Remove a file and try again.`);
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
    const allowed =
      [
        "application/pdf",
        "text/plain",
        "text/markdown",
        "text/x-markdown",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(file.type) || /\.(pdf|docx|txt|md)$/i.test(file.name);
    if (!allowed || file.size > MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024) {
      setError("Practice test must be a PDF, DOCX, TXT, or Markdown file under 10 MB.");
      return;
    }
    setError(null);
    setPracticeTestFile(file);
    if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ""));
  }

  const canSubmit =
    title.trim() &&
    folderId !== null &&
    !isSubmitting &&
    (files.length > 0 || practiceTestFile !== null || folderFileCount > 0);

  return (
    <div className="page page-narrow">
      <Link className="back-link" to="/dashboard">
        <ArrowLeft size={16} />
        Dashboard
      </Link>
      <header className="page-header">
        <div>
          <span className="eyebrow">Generate</span>
          <h1>Create a practice test</h1>
          <p className="muted">
            Upload PDF, DOCX, TXT, or Markdown documents (10 MB each, {MAX_UPLOAD_TOTAL_SIZE_MB} MB total), or use files already saved in the folder, and choose the question style Nosey should generate.
          </p>
        </div>
        <button
          type="button"
          className={`choice ${advancedMode ? "active" : ""}`}
          style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          onClick={() => setAdvancedMode((v) => !v)}
        >
          <Settings2 size={15} />
          Advanced mode
        </button>
      </header>

      {error ? <div className="form-error">{error}</div> : null}

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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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

            <div className="field">
              <span className="field-label">Test type</span>
              <div className="choice-grid">
                {[
                  ["MCQ_only", "Multiple choice"],
                  ["FRQ_only", "Free response"],
                  ["mixed", "Mixed"],
                  ["Extreme", "Extreme MCQ"],
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

            <div className="field">
              <span className="field-label">Mode</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className={`math-mode-toggle ${isMathMode && !isCodingMode ? "active" : ""}`}
                  onClick={() => { setIsMathMode((v) => !v); setIsCodingMode(false); }}
                >
                  <Calculator size={16} />
                  <span>
                    <strong>Math mode</strong>
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
                      {["Python", "JavaScript", "TypeScript", "Java", "C++", "C", "C#", "Go", "Rust", "Swift", "Kotlin", "SQL"].map((lang) => (
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
            <Card className="form-panel">
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                {/* Difficulty */}
                <div>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 10 }}>Difficulty</span>
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

                <div className="field">
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
                <div className="field">
                  <label className="field-label" htmlFor="custom-instructions">
                    Custom instructions <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <textarea
                    id="custom-instructions"
                    className="input"
                    rows={6}
                    placeholder="e.g. Generate 5 word problems involving integration by parts, make all MCQ options close in value, include at least 2 proof questions…"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    maxLength={100000}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                  />
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.8rem" }}>
                    Natural language instructions that guide how questions are generated. Overrides topic focus when both are set.
                    <br />
                    {countWords(customInstructions)} word{countWords(customInstructions) !== 1 ? "s" : ""} used.
                  </p>
                </div>

                {/* Question counts */}
                <div>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 10 }}>Question count</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div className="field">
                      <label className="field-label" htmlFor="count-mcq">MCQ questions</label>
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
                      <label className="field-label" htmlFor="count-frq">FRQ questions</label>
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

                {/* Practice test upload */}
                <div>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>Upload practice test</span>
                  <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: "0.875rem" }}>
                    Upload an existing practice test — Nosey will extract and recreate the questions. If the folder already has saved files, Nosey can also use those for test generation.
                  </p>
                  {practiceTestFile ? (
                    <div className="selected-file" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>
                        <FileText size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
                        {practiceTestFile.name} · {(practiceTestFile.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <button type="button" onClick={() => { setPracticeTestFile(null); if (practiceTestInputRef.current) practiceTestInputRef.current.value = ""; }}>
                        Remove
                      </button>
                    </div>
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
                        accept=".pdf,.docx,.txt,.md,.html,.htm,.pptx,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.swift,.kt,.scala,.rb,.php,.sql,.json,.xml,.yaml,.yml"
                        style={{ display: "none" }}
                        onChange={(e) => acceptPracticeTestFile(e.target.files?.[0])}
                      />
                    </label>
                  )}
                </div>

                {/* Question editor mode */}
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={reviewBeforeTaking}
                    onChange={(e) => setReviewBeforeTaking(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: "var(--green-dark)", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "0.9rem" }}>
                    <strong>Question editor mode</strong> — review and edit questions before taking the test
                  </span>
                </label>
              </div>
            </Card>
          )}

          <Card
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
              accept=".pdf,.docx,.txt,.md,.html,.htm,.pptx,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.swift,.kt,.scala,.rb,.php,.sql,.json,.xml,.yaml,.yml"
              multiple
              onChange={(event) => acceptFiles(event.target.files ?? undefined)}
              type="file"
            />
            {files.length > 0 ? (
              <>
                <FileText size={44} />
                <h2>
                  {files.length} document{files.length === 1 ? "" : "s"} selected
                </h2>
                <p>
                  Each document must be {MAX_UPLOAD_FILE_SIZE_MB} MB or smaller. Combined uploads must stay under {MAX_UPLOAD_TOTAL_SIZE_MB} MB.
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
                <p>PDF, DOCX, TXT, and Markdown files are supported.</p>
              </>
            )}
          </Card>

          <div className="button-row split">
            <Link to="/dashboard">
              <Button variant="secondary">Cancel</Button>
            </Link>
            <Button disabled={!canSubmit} type="submit">
              {isSubmitting ? "Generating..." : "Generate Test"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
