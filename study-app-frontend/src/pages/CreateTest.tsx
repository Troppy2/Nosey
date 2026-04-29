import { ArrowLeft, FileText, Upload } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
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

  useEffect(() => {
    fetchFolders().then((data) => {
      setFolders(data);
      if (data[0]) setFolderId(data[0].id);
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || files.length === 0) return;
    setIsSubmitting(true);
    try {
      const result = await createTest({ folderId, title: title.trim(), testType, files });
      navigate(`/test/${result.test_id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create that practice test.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function acceptFiles(nextFiles?: FileList | File[]) {
    if (!nextFiles || nextFiles.length === 0) return;
    const selected = Array.from(nextFiles).filter((file) => {
      const allowedType = ["application/pdf", "text/plain", "text/markdown", "text/x-markdown"].includes(file.type) || /\.(pdf|txt|md)$/i.test(file.name);
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
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

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
              <p className="muted">Upload up to 5 PDF, TXT, or Markdown documents and choose the question style Nosey should generate.</p>
        </div>
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
            <TextInput label="Test title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Midterm Practice" />
            <SelectInput label="Folder" value={folderId} onChange={(event) => setFolderId(Number(event.target.value))}>
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
          </Card>

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
                <h2>{files.length} document{files.length === 1 ? "" : "s"} selected</h2>
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
            <Button disabled={!title.trim() || files.length === 0 || isSubmitting} type="submit">
              {isSubmitting ? "Generating..." : "Generate Test"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
