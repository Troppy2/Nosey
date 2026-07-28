import {
  ArrowLeft,
  Briefcase,
  Building2,
  ChevronRight,
  Clock,
  Code2,
  FileText,
  Loader2,
  MessageSquare,
  Play,
  Shuffle,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createMockInterviewSession, parseJobDescription } from "../lib/api";
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
import type { MockCustomConfig } from "../lib/types";
import {
  clearActiveMockSession,
  clearMockProgress,
  getActiveMockSession,
  loadMockProgress,
  resumeRouteFor,
  saveMockProgress,
  type MockCompany,
} from "../lib/mockInterview";

const DIFFICULTY_OPTIONS: TaxonomyDifficulty[] = ["Easy", "Medium", "Hard"];

const STAGE_OPTIONS = [
  {
    key: "resume",
    label: "Resume Screen",
    description: "ATS check on your resume: would it clear the screen and earn an OA? Never blocks you.",
    icon: FileText,
    time: "2 min",
  },
  {
    key: "stage1",
    label: "Stage 1: Online Assessment",
    description: "2 to 3 LeetCode problems in a real in-app editor, run against sample cases. No hints.",
    icon: Code2,
    time: "60 to 90 min",
  },
  {
    key: "stage2",
    label: "Stage 2: Technical Interview",
    description: "Conversational AI interviewer. Background, CS questions, then 1 live coding challenge.",
    icon: Users,
    time: "45 min",
  },
  {
    key: "stage3",
    label: "Stage 3: Behavioral Interview",
    description: "Company-specific STAR questions. Type your answers; speak them out loud first.",
    icon: MessageSquare,
    time: "30 to 45 min",
  },
];

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

  const [selectedStages, setSelectedStages] = useState<string[]>([
    "resume",
    "stage1",
    "stage2",
    "stage3",
  ]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Offer to resume an interview that was left in progress.
  const [active, setActive] = useState(() => getActiveMockSession());
  const activeCompanyLabel = active
    ? active.company === "custom"
      ? active.customCompany ?? "Custom"
      : COMPANY_OPTIONS.find((c) => c.key === active.company)?.label ?? active.company
    : "";

  function toggleStage(key: string) {
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

  const totalTime = selectedStages.reduce((sum, key) => {
    const mins = key === "resume" ? 2 : key === "stage1" ? 90 : 45;
    return sum + mins;
  }, 0);

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
              Simulate a real SWE interview loop end to end. No hand-holding.
            </p>
          </div>
          <Briefcase size={28} style={{ color: "var(--green-dark)", flexShrink: 0, marginTop: 4 }} />
        </div>
        <div className="mock-setup-loop-bar">
          <div className="mock-loop-step">
            <div className="mock-loop-step-icon">
              <FileText size={12} />
            </div>
            Resume Screen
          </div>
          <span className="mock-loop-arrow">{"→"}</span>
          <div className="mock-loop-step">
            <div className="mock-loop-step-icon">
              <Code2 size={12} />
            </div>
            Online Assessment
          </div>
          <span className="mock-loop-arrow">{"→"}</span>
          <div className="mock-loop-step">
            <div className="mock-loop-step-icon">
              <Users size={12} />
            </div>
            Technical Interview
          </div>
          <span className="mock-loop-arrow">{"→"}</span>
          <div className="mock-loop-step">
            <div className="mock-loop-step-icon">
              <MessageSquare size={12} />
            </div>
            Behavioral Interview
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
              {customRoleFocus && !analyzing && (
                <span className="muted small" style={{ alignSelf: "center" }}>
                  Read as: {customRoleFocus}
                </span>
              )}
            </div>
            {analyzeError && <p className="small" style={{ color: "var(--error)" }}>{analyzeError}</p>}

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
        <p className="muted small" style={{ marginTop: -4, marginBottom: 10 }}>
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

      {/* Stage selector */}
      <section className="card mock-setup-section">
        <h2 className="eyebrow">Choose Stages</h2>
        <div className="mock-stage-list">
          {STAGE_OPTIONS.map((stage) => {
            const Icon = stage.icon;
            const activeStage = selectedStages.includes(stage.key);
            return (
              <button
                key={stage.key}
                className={`mock-stage-row${activeStage ? " selected" : ""}`}
                onClick={() => toggleStage(stage.key)}
              >
                <div className="mock-stage-check">
                  <div className={`mock-stage-checkbox${activeStage ? " checked" : ""}`} />
                </div>
                <div className="mock-stage-icon-wrap">
                  <Icon size={17} />
                </div>
                <div className="mock-stage-info">
                  <span className="mock-stage-label">{stage.label}</span>
                  <span className="mock-stage-desc">{stage.description}</span>
                </div>
                <span className="mock-stage-time pill">
                  <Clock size={11} style={{ marginRight: 3 }} />
                  {stage.time}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <div className="mock-setup-footer">
        <div className="mock-setup-footer-meta">
          {selectedStages.length > 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              <Clock
                size={12}
                style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }}
              />
              {selectedStages.length} stage{selectedStages.length > 1 ? "s" : ""} selected, about{" "}
              {totalTime} min estimated
            </p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              No stages selected
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
              <Loader2 size={15} className="spin" /> Starting…
            </>
          ) : (
            <>
              Start Interview <ChevronRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
