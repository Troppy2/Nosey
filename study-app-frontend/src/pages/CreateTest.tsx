import { ArrowLeft, Calculator, FileText, Settings2, Upload } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { SelectInput, TextInput } from "../components/Field";
import { createTest, fetchFolders } from "../lib/api";
import type { Folder } from "../lib/types";

const MAX_UPLOAD_DOCUMENTS = 5;
const MAX_UPLOAD_FILE_SIZE_MB = 5;

export default function CreateTest() {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState(1);
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

  useEffect(() => {
    fetchFolders().then((data) => {
      setFolders(data);
      if (data[0]) setFolderId(data[0].id);
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (files.length === 0 && !practiceTestFile) return;
    setIsSubmitting(true);
    try {
      const result = await createTest({
        folderId,
        title: title.trim(),
        testType,
        files,
        countMcq: advancedMode ? countMcq : undefined,
        countFrq: advancedMode ? countFrq : undefined,
        practiceTestFile: advancedMode ? practiceTestFile : null,
        isMathMode,
      });
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
        ["application/pdf", "text/plain", "text/markdown", "text/x-markdown"].includes(file.type) ||
        /\.(pdf|txt|md)$/i.test(file.name);
      return allowedType && file.size <= MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
    });
    if (selected.length === 0) {
      setError(`Upload up to ${MAX_UPLOAD_DOCUMENTS} PDF, TXT, or Markdown documents, each under ${MAX_UPLOAD_FILE_SIZE_MB} MB.`);
      return;
    }
    setError(null);
    setFiles((current) => {
      const merged = [...current, ...selected].slice(0, MAX_UPLOAD_DOCUMENTS);
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
      ["application/pdf", "text/plain", "text/markdown", "text/x-markdown"].includes(file.type) ||
      /\.(pdf|txt|md)$/i.test(file.name);
    if (!allowed || file.size > MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024) {
      setError("Practice test must be a PDF, TXT, or Markdown file under 5 MB.");
      return;
    }
    setError(null);
    setPracticeTestFile(file);
    if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ""));
  }

  const canSubmit = title.trim() && (files.length > 0 || (advancedMode && practiceTestFile !== null)) && !isSubmitting;

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
            Upload up to 5 PDF, TXT, or Markdown documents and choose the question style Nosey should generate.
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
              value={folderId}
              onChange={(e) => setFolderId(Number(e.target.value))}
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </SelectInput>

            <div className="field">
              <span className="field-label">Test type</span>
              <div className="choice-grid">
                {[
                  ["MCQ_only", "Multiple choice"],
                  ["FRQ_only", "Free response"],
                  ["mixed", "Mixed"],
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
              <button
                type="button"
                className={`math-mode-toggle ${isMathMode ? "active" : ""}`}
                onClick={() => setIsMathMode((v) => !v)}
              >
                <Calculator size={16} />
                <span>
                  <strong>Math mode</strong>
                  <span className="math-mode-toggle-sub">
                    Generates calculation problems · symbol keyboard · step-by-step explanations
                  </span>
                </span>
                <span className={`math-mode-pill ${isMathMode ? "on" : "off"}`}>
                  {isMathMode ? "On" : "Off"}
                </span>
              </button>
            </div>
          </Card>

          {/* Advanced Mode panel */}
          {advancedMode && (
            <Card className="form-panel">
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 12 }}>
                    Upload practice test
                  </span>
                  <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: "0.875rem" }}>
                    Upload an existing practice test — Nosey will read the questions and recreate them as an MCQ+FRQ set.
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
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        padding: "8px 14px",
                        border: "1.5px dashed var(--green-light-mid)",
                        borderRadius: 8,
                        fontSize: "0.875rem",
                        color: "var(--green-dark)",
                        background: "var(--green-lightest)",
                      }}
                    >
                      <Upload size={14} />
                      Choose practice test file
                      <input
                        ref={practiceTestInputRef}
                        type="file"
                        accept=".pdf,.txt,.md"
                        style={{ display: "none" }}
                        onChange={(e) => acceptPracticeTestFile(e.target.files?.[0])}
                      />
                    </label>
                  )}
                </div>

                <div>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 12 }}>
                    Question count
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div className="field">
                      <label className="field-label" htmlFor="count-mcq">
                        MCQ questions
                      </label>
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
                      <label className="field-label" htmlFor="count-frq">
                        FRQ questions
                      </label>
                      <input
                        id="count-frq"
                        type="number"
                        min={0}
                        max={50}
                        value={countFrq}
                        onChange={(e) => setCountFrq(Math.max(0, Math.min(50, Number(e.target.value))))}
                        className="input"
                        disabled={testType === "MCQ_only"}
                        style={{ opacity: testType === "MCQ_only" ? 0.4 : 1 }}
                      />
                    </div>
                  </div>
                </div>

                <label
                  style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
                >
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
              accept=".pdf,.txt,.md"
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
                <p>Each document must be 5 MB or smaller. You can upload up to {MAX_UPLOAD_DOCUMENTS} documents.</p>
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
                <p>PDF, TXT, or Markdown files work best for the current backend.</p>
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
