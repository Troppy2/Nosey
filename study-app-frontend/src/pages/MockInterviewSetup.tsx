import { Loader2 } from "lucide-react";
import { ArrowLeftIcon, BookIcon, CheckIcon, ChevronRightIcon, CloseIcon, PlusIcon, SparklesIcon } from "../icons";
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
import "../styles/components/mock-debrief.css";
import "../styles/components/mock-setup.css";


const DIFFICULTY_OPTIONS: TaxonomyDifficulty[] = ["Easy", "Medium", "Hard"];

// Target seniority. Drives the difficulty mix of Stage 1 problems and how strict
// the AI interviewer is across every stage. Internship is the default.
const LEVEL_OPTIONS: { key: InterviewLevel; label: string; description: string }[] = [
  { key: "intern", label: "Internship", description: "Easier problems, an encouraging interviewer" },
  { key: "junior", label: "Junior / New Grad", description: "Standard new-grad bar" },
  { key: "mid", label: "Mid-Level", description: "Probing follow-ups, near-optimal expected" },
  { key: "senior", label: "Senior", description: "Hard problems, deep and rigorous" },
];

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
    <div className="setup2">
      <header className="setup2-head">
        <div className="setup2-head-left">
          <button type="button" className="debrief-back" onClick={() => navigate("/leetcode")}>
            <ArrowLeftIcon size={16} /> KojoCode
          </button>
          <h1>Run an interview loop</h1>
        </div>
        <button type="button" className="setup2-history" onClick={() => navigate("/mock-interview/history")}>
          Past interviews
        </button>
      </header>

      {/* Resume banner */}
      {active && (
        <div className="setup2-resume">
          <div className="setup2-resume-info">
            <span>{activeCompanyLabel} interview in progress</span>
            <span>Pick up where you left off.</span>
          </div>
          <button type="button" className="setup2-resume-go" onClick={handleResume}>
            Resume
          </button>
          <button type="button" className="setup2-resume-drop" onClick={handleDiscard} title="Discard saved progress" aria-label="Discard saved progress">
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {/* Company selector */}
      <section className="setup2-section">
        <h2>Company</h2>
        <div className="setup2-pills">
          {COMPANY_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`setup2-pill${selectedCompany === opt.key ? " is-on" : ""}`}
              aria-pressed={selectedCompany === opt.key}
              onClick={() => setSelectedCompany(opt.key)}
            >
              {opt.key === "random" ? "Surprise me" : opt.label}
            </button>
          ))}
          <button
            type="button"
            className={`setup2-pill setup2-pill-dashed${selectedCompany === "custom" ? " is-on" : ""}`}
            aria-pressed={selectedCompany === "custom"}
            onClick={() => setSelectedCompany("custom")}
          >
            <PlusIcon size={16} /> Paste a job description
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
                        <BookIcon size={13} />
                        {jd.name}
                      </button>
                      <button
                        type="button"
                        className="mock-saved-jd-delete"
                        onClick={() => void handleDeleteJd(jd.id)}
                        aria-label={`Delete saved job description ${jd.name}`}
                        title="Delete"
                      >
                        <CloseIcon size={12} />
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
                {analyzing ? <Loader2 size={14} className="spin" /> : <SparklesIcon size={14} />}
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
                {savingJd ? <Loader2 size={14} className="spin" /> : <CheckIcon size={14} />}
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
      <section className="setup2-section">
        <h2>Level</h2>
        <div className="setup2-segment" role="radiogroup" aria-label="Level">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={selectedLevel === opt.key}
              className={selectedLevel === opt.key ? "is-on" : ""}
              onClick={() => setSelectedLevel(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="setup2-hint">{LEVEL_OPTIONS.find((o) => o.key === selectedLevel)?.description}</p>
      </section>

      {/* Rounds: the loop rail. Tap a station to switch that round on or off. */}
      <section className="setup2-section setup2-loop">
        <div className="setup2-rounds-head">
          <h2>Rounds</h2>
          <span>Tap a round to skip it. The rail shows how long each one takes.</span>
        </div>
        <MockLoopRail selected={selectedStages} onToggle={toggleStage} />
      </section>

      <div className="setup2-footer">
        <div className="setup2-footer-meta">
          {selectedStages.length > 0 ? (
            <span>
              <strong>
                {selectedStages.length} round{selectedStages.length > 1 ? "s" : ""}
              </strong>
              , about {formatLoopDuration(totalTime)}
            </span>
          ) : (
            <span>Pick at least one round to run.</span>
          )}
          {error && <p className="mock-setup-error">{error}</p>}
        </div>
        <button type="button" className="setup2-start" onClick={handleStart} disabled={starting || selectedStages.length === 0}>
          {starting ? (
            <>
              <Loader2 size={15} className="spin" /> Starting the loop
            </>
          ) : (
            <>
              Start the loop <ChevronRightIcon size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
