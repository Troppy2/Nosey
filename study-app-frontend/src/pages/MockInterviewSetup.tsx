import {
  ArrowLeft,
  Building2,
  ChevronRight,
  FileText,
  History,
  Loader2,
  Play,
  Save,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createMockInterviewSession,
  deleteJobDescription,
  fetchActiveMockSession,
  listJobDescriptions,
  parseJobDescription,
  saveJobDescription,
  updateJobDescription,
} from "../lib/api";
import {
  COMPANY_OPTIONS,
  type CompanyKey,
  type InterviewLevel,
} from "../data/mockInterviewProblems";
import {
  TAXONOMY_TOPICS,
  resolvePastedProblems,
  subtopicsForTopics,
  type TaxonomyDifficulty,
} from "../data/leetcodeTaxonomy";
import type { MockCustomConfig, SavedJobDescription } from "../lib/types";
import {
  clearActiveMockSession,
  clearMockProgress,
  getActiveMockSession,
  loadMockProgress,
  resumeRouteFor,
  saveMockProgress,
  type MockCompany,
  type MockProgress,
} from "../lib/mockInterview";
import { MockLoopRail } from "../components/MockLoopRail";
import { formatLoopDuration, totalLoopMinutes, type LoopStageKey } from "../data/mockInterviewLoop";

const DIFFICULTY_OPTIONS: TaxonomyDifficulty[] = ["Easy", "Medium", "Hard"];

// Target seniority. Drives the difficulty mix of Stage 1 problems and how strict
// the AI interviewer is across every stage. Internship is the default.
const LEVEL_OPTIONS: { key: InterviewLevel; label: string; description: string }[] = [
  { key: "intern", label: "Internship", description: "Easier problems, an encouraging interviewer" },
  { key: "junior", label: "Junior / New Grad", description: "Standard new-grad bar" },
  { key: "mid", label: "Mid-Level", description: "Probing follow-ups, near-optimal expected" },
  { key: "senior", label: "Senior", description: "Hard problems, deep and rigorous" },
];

const COMPANY_BRAND: Record<CompanyKey, { color: string; initial: string }> = {
  google: { color: "#4285F4", initial: "G" },
  meta: { color: "#7B68EE", initial: "M" },
  amazon: { color: "#FF9900", initial: "A" },
  apple: { color: "#1d1d1f", initial: "" },
  microsoft: { color: "#0078D4", initial: "M" },
  netflix: { color: "#E50914", initial: "N" },
  random: { color: "#276749", initial: "" },
};

export default function MockInterviewSetup() {
  const navigate = useNavigate();
  const [selectedCompany, setSelectedCompany] = useState<MockCompany>("google");
  const [selectedLevel, setSelectedLevel] = useState<InterviewLevel>("intern");

  // Custom-company (job description) state.
  const [customName, setCustomName] = useState("");
  const [jdText, setJdText] = useState("");
  const [customRoleFocus, setCustomRoleFocus] = useState("");
  const [customCulture, setCustomCulture] = useState("");
  const [selectedDifficulties, setSelectedDifficulties] = useState<TaxonomyDifficulty[]>(["Easy", "Medium"]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedSubtopics, setSelectedSubtopics] = useState<string[]>([]);
  const [pastedProblems, setPastedProblems] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Saved JDs, so a JD is pasted and analyzed once and reused after that.
  // loadedJdId tracks which saved JD is currently in the panel, which turns the save
  // button into an update instead of creating a near-duplicate.
  const [savedJds, setSavedJds] = useState<SavedJobDescription[]>([]);
  const [loadedJdId, setLoadedJdId] = useState<number | null>(null);
  const [savingJd, setSavingJd] = useState(false);
  const [jdSaveNote, setJdSaveNote] = useState<string | null>(null);

  const [selectedStages, setSelectedStages] = useState<string[]>([
    "resume",
    "stage1",
    "stage2",
    "stage3",
  ]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Offer to resume an interview that was left in progress. The local pointer answers
  // instantly; if this device has none (fresh browser, cleared storage, different
  // machine) the server is asked for the newest unfinished run.
  const [active, setActive] = useState(() => getActiveMockSession());
  useEffect(() => {
    if (active) return;
    let cancelled = false;
    fetchActiveMockSession()
      .then((session) => {
        if (cancelled || !session?.progress_json) return;
        const remote = JSON.parse(session.progress_json) as MockProgress;
        if (!remote?.sessionId) return;
        // Write the snapshot locally so Resume behaves exactly as it does on the
        // device the run started on.
        saveMockProgress(remote);
        setActive(getActiveMockSession());
      })
      .catch(() => {
        // No server run, or offline. The banner just stays hidden.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const activeCompanyLabel = active
    ? active.company === "custom"
      ? active.customCompany ?? "Custom"
      : COMPANY_OPTIONS.find((c) => c.key === active.company)?.label ?? active.company
    : "";

  function toggleStage(key: LoopStageKey) {
    setSelectedStages((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key],
    );
  }

  function toggleDifficulty(d: TaxonomyDifficulty) {
    setSelectedDifficulties((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  function toggleTopic(id: string) {
    const isRemoving = selectedTopics.includes(id);
    const nextTopics = isRemoving ? selectedTopics.filter((x) => x !== id) : [...selectedTopics, id];
    setSelectedTopics(nextTopics);
    if (isRemoving) {
      // Keep only subtopics still covered by a topic that remains selected.
      const stillAvailable = new Set(subtopicsForTopics(nextTopics).map((s) => s.label));
      setSelectedSubtopics((subs) => subs.filter((s) => stillAvailable.has(s)));
    }
  }

  function toggleSubtopic(label: string) {
    setSelectedSubtopics((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  }

  // Saved JDs load lazily: they only matter once the custom path is picked.
  useEffect(() => {
    if (selectedCompany !== "custom" || savedJds.length > 0) return;
    let cancelled = false;
    listJobDescriptions()
      .then((rows) => {
        if (!cancelled) setSavedJds(rows);
      })
      .catch(() => {
        // Not fatal: the panel still works, you just paste the JD by hand.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany]);

  // Refill the whole custom panel from a saved JD. The stored analysis stands in for
  // the parse-jd call, so loading one costs nothing.
  function applySavedJd(jd: SavedJobDescription) {
    setLoadedJdId(jd.id);
    setJdSaveNote(null);
    setAnalyzeError(null);
    setJdText(jd.jd_text);
    setCustomName(jd.company_name ?? jd.name);
    const parsed = jd.parsed;
    if (!parsed) return;
    setCustomRoleFocus(parsed.role_focus);
    setCustomCulture(parsed.culture);
    if (parsed.seniority) setSelectedLevel(parsed.seniority as InterviewLevel);
    if (parsed.topics.length > 0) setSelectedTopics(parsed.topics);
    setSelectedSubtopics(parsed.subtopics ?? []);
    if (parsed.difficulties.length > 0) {
      setSelectedDifficulties(parsed.difficulties as TaxonomyDifficulty[]);
    }
  }

  async function handleSaveJd() {
    const jd = jdText.trim();
    if (jd.length < 20 || savingJd) return;
    // Name it after the company when there is one, so the picker reads like a list of
    // roles rather than "Untitled 1, Untitled 2".
    const name = (customName.trim() || "Saved job description").slice(0, 120);
    const parsed = {
      role_focus: customRoleFocus,
      culture: customCulture,
      seniority: selectedLevel,
      topics: selectedTopics,
      subtopics: selectedSubtopics,
      difficulties: selectedDifficulties,
    };
    setSavingJd(true);
    setJdSaveNote(null);
    try {
      const saved = loadedJdId
        ? await updateJobDescription(loadedJdId, {
            name,
            company_name: customName.trim() || null,
            jd_text: jd,
            parsed,
          })
        : await saveJobDescription({
            name,
            company_name: customName.trim() || null,
            jd_text: jd,
            parsed,
          });
      setSavedJds((prev) => [saved, ...prev.filter((row) => row.id !== saved.id)]);
      setLoadedJdId(Number(saved.id));
      setJdSaveNote(`Saved as "${saved.name}". Pick it from the list next time.`);
    } catch (e: unknown) {
      setJdSaveNote(e instanceof Error ? e.message : "Could not save this job description.");
    } finally {
      setSavingJd(false);
    }
  }

  async function handleDeleteJd(jdId: number) {
    try {
      await deleteJobDescription(jdId);
      setSavedJds((prev) => prev.filter((row) => row.id !== jdId));
      if (loadedJdId === jdId) setLoadedJdId(null);
    } catch (e: unknown) {
      setJdSaveNote(e instanceof Error ? e.message : "Could not delete that job description.");
    }
  }

  async function handleAnalyzeJd() {
    const jd = jdText.trim();
    if (jd.length < 20) {
      setAnalyzeError("Paste a job description first (a sentence or two minimum).");
      return;
    }
    setAnalyzeError(null);
    setAnalyzing(true);
    try {
      const result = await parseJobDescription(jd, TAXONOMY_TOPICS.map((t) => t.id));
      if (result.company_name && !customName.trim()) setCustomName(result.company_name);
      setCustomRoleFocus(result.role_focus);
      setCustomCulture(result.culture);
      if (result.seniority) setSelectedLevel(result.seniority);
      if (result.suggested_topics.length > 0) setSelectedTopics(result.suggested_topics);
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "Could not analyze the job description.");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleResume() {
    if (!active) return;
    const progress = loadMockProgress(active.sessionId);
    if (!progress) {
      clearActiveMockSession();
      setActive(null);
      return;
    }
    navigate(resumeRouteFor(progress), {
      state: {
        session: {
          id: progress.sessionId,
          company: progress.company,
          level: progress.level,
          custom_company: progress.customCompany,
          custom_config: progress.customConfig,
        },
        selectedStages: progress.selectedStages,
      },
    });
  }

  function handleDiscard() {
    if (active) clearMockProgress(active.sessionId);
    clearActiveMockSession();
    setActive(null);
  }

  async function handleStart() {
    if (selectedStages.length === 0) {
      setError("Select at least one stage.");
      return;
    }

    // Build the custom-company config from the JD panel, if that path is selected.
    let customCompany: string | undefined;
    let customConfig: MockCustomConfig | undefined;
    if (selectedCompany === "custom") {
      const name = customName.trim();
      const problems = resolvePastedProblems(pastedProblems);
      if (!name) {
        setError("Give the company a name (or paste and analyze a job description).");
        return;
      }
      if (problems.length === 0 && selectedTopics.length === 0) {
        setError("Pick at least one topic, or paste some specific problems.");
        return;
      }
      customCompany = name;
      customConfig = {
        role_focus: customRoleFocus,
        culture: customCulture,
        topics: selectedTopics,
        subtopics: selectedSubtopics,
        difficulties: selectedDifficulties,
        problems: problems.map((p) => ({ slug: p.slug, title: p.title, difficulty: p.difficulty })),
      };
    }

    setError(null);
    setStarting(true);
    try {
      const session = await createMockInterviewSession(
        selectedCompany,
        selectedStages,
        selectedLevel,
        customCompany && customConfig
          ? { custom_company: customCompany, jd_text: jdText.trim(), custom_config: customConfig }
          : undefined,
      );
      const firstStage = selectedStages.includes("resume")
        ? "resume"
        : selectedStages.includes("stage1")
        ? "stage1"
        : selectedStages.includes("stage2")
        ? "stage2"
        : "stage3";
      // Seed an initial snapshot so a refresh immediately after starting still resumes.
      saveMockProgress({
        sessionId: session.id,
        company: selectedCompany,
        level: selectedLevel,
        customCompany,
        customConfig,
        selectedStages,
        updatedAt: Date.now(),
      });
      navigate(`/mock-interview/${session.id}/${firstStage}`, {
        state: { session, selectedStages },
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start interview. Try again.");
      setStarting(false);
    }
  }

  const totalTime = totalLoopMinutes(selectedStages);

  return (
    <div className="page page-narrow">
      <button className="mock-back-link" onClick={() => navigate("/leetcode")}>
        <ArrowLeft size={16} /> KojoCode
      </button>
      <div className="mock-setup-hero">
        <div className="mock-setup-hero-top">
          <div>
            <span className="eyebrow">Mock Interview Mode</span>
            <h1 className="mock-setup-hero-title" style={{ marginTop: 6 }}>
              Interview Loop Simulator
            </h1>
            <p className="muted small" style={{ marginTop: 6 }}>
              Run a real SWE loop end to end, on the clock, with no hints.
            </p>
          </div>
          <div className="mock-setup-hero-actions">
            <button
              type="button"
              className="button button-ghost mock-history-link"
              onClick={() => navigate("/mock-interview/history")}
            >
              <History size={15} /> Past interviews
            </button>
          </div>
        </div>
      </div>

      {/* Resume banner */}
      {active && (
        <div className="card mock-resume-banner">
          <div className="mock-resume-banner-info">
            <Play size={16} style={{ color: "var(--green-dark)", flexShrink: 0 }} />
            <div>
              <div className="mock-resume-banner-title">Resume your {activeCompanyLabel} interview</div>
              <div className="muted small">You have an interview in progress. Pick up where you left off.</div>
            </div>
          </div>
          <div className="mock-resume-banner-actions">
            <button className="button button-primary" onClick={handleResume}>
              Resume <ChevronRight size={14} />
            </button>
            <button
              className="button button-ghost mock-resume-discard"
              onClick={handleDiscard}
              title="Discard saved progress"
            >
              <X size={14} /> Discard
            </button>
          </div>
        </div>
      )}

      {/* Company selector */}
      <section className="card mock-setup-section">
        <h2 className="eyebrow">Choose Company</h2>
        <div className="mock-company-grid">
          {COMPANY_OPTIONS.map((opt) => {
            const brand = COMPANY_BRAND[opt.key] ?? { color: "#888", initial: "?" };
            const isRandom = opt.key === "random";
            const isApple = opt.key === "apple";
            return (
              <button
                key={opt.key}
                className={`mock-company-btn${selectedCompany === opt.key ? " selected" : ""}`}
                onClick={() => setSelectedCompany(opt.key)}
              >
                <div className="mock-company-avatar" style={{ background: brand.color }}>
                  {isRandom ? (
                    <Shuffle size={18} color="#fff" />
                  ) : isApple ? (
                    <svg width="18" height="22" viewBox="0 0 814 1000" fill="#fff">
                      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.1 0 665.8 0 546.5c0-211.9 138.5-323.9 275.1-323.9 70.6 0 129.5 46.4 173.5 46.4 42.2 0 108.5-49.5 188.5-49.5 30.6 0 108.2 2.6 168.7 80.5zM552.5 85.3c29.2-35.1 50.2-83.4 50.2-131.7 0-6.5-.6-13-1.9-19.5-47.6 1.9-104 32.5-138.2 73.8-26.6 30.8-50.7 79.1-50.7 128.7 0 7.1 1.3 14.2 1.9 16.5 3.2.6 8.4 1.3 13.7 1.3 42.8 0 96.9-29.1 125-69.1z" />
                    </svg>
                  ) : (
                    <span className="mock-company-initial">{brand.initial}</span>
                  )}
                </div>
                <span className="mock-company-label">{opt.label}</span>
              </button>
            );
          })}
          <button
            className={`mock-company-btn${selectedCompany === "custom" ? " selected" : ""}`}
            onClick={() => setSelectedCompany("custom")}
          >
            <div className="mock-company-avatar" style={{ background: "#4b5563" }}>
              <Building2 size={18} color="#fff" />
            </div>
            <span className="mock-company-label">Custom (JD)</span>
          </button>
        </div>

        {selectedCompany === "custom" && (
          <div className="mock-custom-panel">
            <p className="muted small" style={{ marginTop: 4 }}>
              Paste a job description and Nosey builds a mock interview for that company. Pick the
              difficulties and topics it tends to ask, or paste specific problems.
            </p>

            {/* Saved JDs: pick one to refill this whole panel from the stored analysis,
                no re-paste and no second trip to the model. */}
            {savedJds.length > 0 && (
              <>
                <label className="mock-custom-label">Saved job descriptions</label>
                <div className="mock-saved-jd-row">
                  {savedJds.map((jd) => (
                    <span
                      key={jd.id}
                      className={`mock-saved-jd${loadedJdId === jd.id ? " selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="mock-saved-jd-load"
                        onClick={() => applySavedJd(jd)}
                        title={jd.company_name ? `Load ${jd.name} (${jd.company_name})` : `Load ${jd.name}`}
                      >
                        <FileText size={13} />
                        {jd.name}
                      </button>
                      <button
                        type="button"
                        className="mock-saved-jd-delete"
                        onClick={() => void handleDeleteJd(jd.id)}
                        aria-label={`Delete saved job description ${jd.name}`}
                        title="Delete"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </>
            )}

            <label className="mock-custom-label" htmlFor="mock-custom-name">Company name</label>
            <input
              id="mock-custom-name"
              className="mock-custom-input"
              placeholder="e.g. Stripe"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />

            <label className="mock-custom-label" htmlFor="mock-jd">Job description</label>
            <textarea
              id="mock-jd"
              className="mock-custom-textarea"
              placeholder="Paste the full job description here..."
              rows={6}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
            />
            <div className="button-row" style={{ marginTop: 8 }}>
              <button
                className="button button-secondary"
                onClick={handleAnalyzeJd}
                disabled={analyzing}
              >
                {analyzing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                {analyzing ? "Analyzing" : "Analyze job description"}
              </button>
              <button
                className="button button-secondary"
                onClick={() => void handleSaveJd()}
                disabled={savingJd || jdText.trim().length < 20}
                title={
                  jdText.trim().length < 20
                    ? "Paste a job description first"
                    : loadedJdId
                    ? "Update this saved job description"
                    : "Save this job description to reuse later"
                }
              >
                {savingJd ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                {loadedJdId ? "Update saved JD" : "Save this JD"}
              </button>
              {customRoleFocus && !analyzing && (
                <span className="muted small" style={{ alignSelf: "center" }}>
                  Read as: {customRoleFocus}
                </span>
              )}
            </div>
            {analyzeError && <p className="small" style={{ color: "var(--error)" }}>{analyzeError}</p>}
            {jdSaveNote && <p className="small muted">{jdSaveNote}</p>}

            <label className="mock-custom-label">Difficulty</label>
            <div className="mock-chip-row">
              {DIFFICULTY_OPTIONS.map((d) => (
                <button
                  key={d}
                  className={`mock-chip${selectedDifficulties.includes(d) ? " selected" : ""}`}
                  onClick={() => toggleDifficulty(d)}
                >
                  {d}
                </button>
              ))}
            </div>

            <label className="mock-custom-label">
              Topics usually asked {selectedTopics.length > 0 ? `(${selectedTopics.length})` : ""}
            </label>
            <div className="mock-chip-row">
              {TAXONOMY_TOPICS.map((t) => (
                <button
                  key={t.id}
                  className={`mock-chip${selectedTopics.includes(t.id) ? " selected" : ""}`}
                  onClick={() => toggleTopic(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {selectedTopics.length > 0 && (
              <>
                <label className="mock-custom-label">
                  Specific techniques {selectedSubtopics.length > 0 ? `(${selectedSubtopics.length})` : "(optional)"}
                </label>
                {selectedTopics.map((topicId) => {
                  const subs = subtopicsForTopics([topicId]);
                  if (subs.length === 0) return null;
                  const topicLabel = TAXONOMY_TOPICS.find((t) => t.id === topicId)?.label ?? topicId;
                  return (
                    <div key={topicId} className="mock-subtopic-group">
                      <span className="mock-subtopic-group-label">{topicLabel}</span>
                      <div className="mock-chip-row">
                        {subs.map((s) => (
                          <button
                            key={`${topicId}-${s.label}`}
                            className={`mock-chip mock-chip-sm${selectedSubtopics.includes(s.label) ? " selected" : ""}`}
                            onClick={() => toggleSubtopic(s.label)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            <label className="mock-custom-label" htmlFor="mock-paste-problems">
              Or paste specific problems (optional, one per line)
            </label>
            <textarea
              id="mock-paste-problems"
              className="mock-custom-textarea"
              placeholder={"two-sum\nhttps://leetcode.com/problems/valid-anagram/\nMerge Intervals"}
              rows={3}
              value={pastedProblems}
              onChange={(e) => setPastedProblems(e.target.value)}
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              Pasted problems take priority over the topic selection for Stage 1.
            </p>
          </div>
        )}
      </section>

      {/* Level selector */}
      <section className="card mock-setup-section">
        <h2 className="eyebrow">Choose Level</h2>
        <p className="muted small" style={{ marginTop: 4, marginBottom: 12 }}>
          Sets the difficulty of Stage 1 problems and how strict the interviewer is. Defaults to internship.
        </p>
        <div className="mock-level-grid">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`mock-level-btn${selectedLevel === opt.key ? " selected" : ""}`}
              onClick={() => setSelectedLevel(opt.key)}
            >
              <span className="mock-level-label">{opt.label}</span>
              <span className="mock-level-desc">{opt.description}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Stage selector: the loop spine. Rail length tracks the time each stage costs. */}
      <section className="card mock-setup-section mock-loop-section">
        <div className="mock-loop-section-head">
          <h2 className="eyebrow">Your loop</h2>
          <p className="muted small">
            Switch off any stage you do not want to sit today. The rail shows what each one costs you.
          </p>
        </div>
        <MockLoopRail selected={selectedStages} onToggle={toggleStage} />
      </section>

      {/* Footer */}
      <div className="mock-setup-footer">
        <div className="mock-setup-footer-meta">
          {selectedStages.length > 0 ? (
            <p className="mock-setup-tally">
              <span className="loop-num">{selectedStages.length}</span>
              <span className="loop-unit">stage{selectedStages.length > 1 ? "s" : ""}</span>
              <span className="mock-tally-sep" aria-hidden="true" />
              <span className="loop-num">{formatLoopDuration(totalTime)}</span>
              <span className="loop-unit">on the clock</span>
            </p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Pick at least one stage to run.
            </p>
          )}
          {error && <p className="mock-setup-error">{error}</p>}
        </div>
        <button
          className="button button-primary mock-start-btn"
          onClick={handleStart}
          disabled={starting || selectedStages.length === 0}
        >
          {starting ? (
            <>
              <Loader2 size={15} className="spin" /> Starting the loop
            </>
          ) : (
            <>
              Start the loop <ChevronRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
