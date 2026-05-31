import { Briefcase, ChevronRight, Clock, Code2, Loader2, MessageSquare, Shuffle, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createMockInterviewSession } from "../lib/api";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";

const STAGE_OPTIONS = [
  {
    key: "stage1",
    label: "Stage 1 — Online Assessment",
    description: "2–3 LeetCode Medium/Hard problems under timed conditions. No hints.",
    icon: Code2,
    time: "60–90 min",
  },
  {
    key: "stage2",
    label: "Stage 2 — Technical Interview",
    description: "AI interviewer reads a script. DS/Algo questions + 1 live coding challenge.",
    icon: Users,
    time: "45 min",
  },
  {
    key: "stage3",
    label: "Stage 3 — Behavioral Interview",
    description: "Company-specific STAR questions. Type your answers; speak them out loud first.",
    icon: MessageSquare,
    time: "30–45 min",
  },
];

const COMPANY_BRAND: Record<CompanyKey, { color: string; initial: string }> = {
  google:    { color: "#4285F4", initial: "G" },
  meta:      { color: "#7B68EE", initial: "M" },
  amazon:    { color: "#FF9900", initial: "A" },
  apple:     { color: "#1d1d1f", initial: "" },
  microsoft: { color: "#0078D4", initial: "M" },
  netflix:   { color: "#E50914", initial: "N" },
  random:    { color: "#276749", initial: "" },
};

export default function MockInterviewSetup() {
  const navigate = useNavigate();
  const [selectedCompany, setSelectedCompany] = useState<CompanyKey>("google");
  const [selectedStages, setSelectedStages] = useState<string[]>(["stage1", "stage2", "stage3"]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleStage(key: string) {
    setSelectedStages((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

  async function handleStart() {
    if (selectedStages.length === 0) {
      setError("Select at least one stage.");
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const session = await createMockInterviewSession(selectedCompany, selectedStages);
      const firstStage = selectedStages.includes("stage1")
        ? "stage1"
        : selectedStages.includes("stage2")
        ? "stage2"
        : "stage3";
      navigate(`/mock-interview/${session.id}/${firstStage}`, {
        state: { session, selectedStages },
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start interview. Try again.");
      setStarting(false);
    }
  }

  const totalTime = selectedStages.reduce((sum, key) => {
    const mins = key === "stage1" ? 90 : key === "stage2" ? 45 : 45;
    return sum + mins;
  }, 0);

  return (
    <div className="page page-narrow">
      {/* Hero */}
      <div className="mock-setup-hero">
        <div className="mock-setup-hero-top">
          <div>
            <span className="eyebrow">Mock Interview Mode</span>
            <h1 className="mock-setup-hero-title" style={{ marginTop: 6 }}>Interview Loop Simulator</h1>
            <p className="muted small" style={{ marginTop: 6 }}>
              Simulate a real SWE interview loop end-to-end. No hand-holding.
            </p>
          </div>
          <Briefcase size={28} style={{ color: "var(--green-dark)", flexShrink: 0, marginTop: 4 }} />
        </div>
        <div className="mock-setup-loop-bar">
          <div className="mock-loop-step">
            <div className="mock-loop-step-icon"><Code2 size={12} /></div>
            Online Assessment
          </div>
          <span className="mock-loop-arrow">→</span>
          <div className="mock-loop-step">
            <div className="mock-loop-step-icon"><Users size={12} /></div>
            Technical Interview
          </div>
          <span className="mock-loop-arrow">→</span>
          <div className="mock-loop-step">
            <div className="mock-loop-step-icon"><MessageSquare size={12} /></div>
            Behavioral Interview
          </div>
        </div>
      </div>

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
                      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.1 0 665.8 0 546.5c0-211.9 138.5-323.9 275.1-323.9 70.6 0 129.5 46.4 173.5 46.4 42.2 0 108.5-49.5 188.5-49.5 30.6 0 108.2 2.6 168.7 80.5zM552.5 85.3c29.2-35.1 50.2-83.4 50.2-131.7 0-6.5-.6-13-1.9-19.5-47.6 1.9-104 32.5-138.2 73.8-26.6 30.8-50.7 79.1-50.7 128.7 0 7.1 1.3 14.2 1.9 16.5 3.2.6 8.4 1.3 13.7 1.3 42.8 0 96.9-29.1 125-69.1z"/>
                    </svg>
                  ) : (
                    <span className="mock-company-initial">{brand.initial}</span>
                  )}
                </div>
                <span className="mock-company-label">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Stage selector */}
      <section className="card mock-setup-section">
        <h2 className="eyebrow">Choose Stages</h2>
        <div className="mock-stage-list">
          {STAGE_OPTIONS.map((stage) => {
            const Icon = stage.icon;
            const active = selectedStages.includes(stage.key);
            return (
              <button
                key={stage.key}
                className={`mock-stage-row${active ? " selected" : ""}`}
                onClick={() => toggleStage(stage.key)}
              >
                <div className="mock-stage-check">
                  <div className={`mock-stage-checkbox${active ? " checked" : ""}`} />
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
              <Clock size={12} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
              {selectedStages.length} stage{selectedStages.length > 1 ? "s" : ""} selected · ~{totalTime} min estimated
            </p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>No stages selected</p>
          )}
          {error && <p className="mock-setup-error">{error}</p>}
        </div>
        <button
          className="button button-primary mock-start-btn"
          onClick={handleStart}
          disabled={starting || selectedStages.length === 0}
        >
          {starting ? (
            <><Loader2 size={15} className="spin" /> Starting…</>
          ) : (
            <>Start Interview <ChevronRight size={16} /></>
          )}
        </button>
      </div>
    </div>
  );
}
