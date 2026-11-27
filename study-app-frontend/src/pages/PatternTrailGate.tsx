import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/Field";
import { InlineLoading } from "../components/Loaders";
import { Skeleton, SkeletonTrailGate } from "../components/Skeletons";
import { YarnBall } from "../components/trails/YarnBall";
import { usePageTour } from "../components/tours/usePageTour";
import { AlertIcon, CheckCircleIcon, ChevronLeftIcon, CrossCircleIcon, SummitIcon } from "../icons";
import { fetchTrailGateAttempt, fetchTrailGateProblem, fetchTrailMap, pickTrailGate, startTrailGate } from "../lib/api";
import { sanitizeLeetCodeHtml } from "../lib/leetcodeHtml";
import { toast } from "../lib/toast";
import {
  REASON_MAX,
  currentTurn,
  gateEditorUrl,
  gateUrl,
  patternTitle,
  problemLabel,
  progressLine,
  readGateSolve,
  reasonCheck,
  reopensIn,
  solveLine,
  statementParagraphs,
  withoutFollowUp,
} from "../lib/trailGate";
import { dueIn, formatMinutes } from "../lib/trailView";
import type { PTGateAttempt, PTGateItem, PTGateProblem, PTGateState } from "../lib/types";
import { useMobileShell } from "../lib/useMobileShell";
import "../styles/pages/pattern-trails.css";

type Intro = { title: string; gate: PTGateState };

/** One dot per problem: right, missed, the one in hand, still to come. */
function GateDots({ attempt, current }: { attempt: PTGateAttempt; current: number | null }) {
  return (
    <ol className="pt-gate-dots" aria-label={progressLine(attempt)}>
      {[...attempt.items]
        .sort((a, b) => a.position - b.position)
        .map((item) => {
          const state =
            item.correct === true ? "right" : item.correct === false ? "missed" : item.id === current ? "current" : "todo";
          return <li key={item.id} className={`pt-gate-dot is-${state}`} aria-hidden="true" />;
        })}
    </ol>
  );
}

function Statement({ problem }: { problem: PTGateProblem }) {
  const html = useMemo(
    () => (problem.statement_text ? "" : sanitizeLeetCodeHtml(withoutFollowUp(problem.content_html))),
    [problem],
  );
  if (!problem.statement_text) {
    return <div className="lc-official-statement pt-gate-statement" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className="pt-gate-statement">
      {statementParagraphs(problem.statement_text).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {problem.examples.length ? (
        <ol className="pt-gate-examples">
          {problem.examples.map((ex) => (
            <li key={ex.index}>
              <b>Example {ex.index}</b>
              <code>Input: {ex.input_text}</code>
              <code>Output: {ex.output_text}</code>
              {ex.explanation_text ? <span className="muted">{ex.explanation_text}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ProblemPanel({
  item,
  attempt,
  problem,
  error,
  onRetry,
}: {
  item: PTGateItem;
  attempt: PTGateAttempt;
  problem: PTGateProblem | null;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="pt-panel pt-gate-problem" aria-labelledby="pt-gate-problem-title">
      <div className="pt-panel-head">
        <h2 id="pt-gate-problem-title">{problemLabel(item, attempt)}</h2>
        <span className="pill">{item.difficulty}</span>
      </div>
      <p className="muted small">
        Title and tags are hidden. You solve it in the editor after you pick, with {formatMinutes(item.time_limit_s)} on the clock.
      </p>
      {error ? (
        <div className="pt-gate-problem-error">
          <p>{error}</p>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : problem ? (
        <Statement problem={problem} />
      ) : (
        <div className="pt-gate-statement-skel" role="status" aria-label="Loading the problem">
          <Skeleton width="100%" height="0.9rem" />
          <Skeleton width="92%" height="0.9rem" />
          <Skeleton width="80%" height="0.9rem" />
          <Skeleton width="100%" height="72px" />
        </div>
      )}
    </section>
  );
}

function PickResult({
  item,
  attempt,
  reason,
  onSolve,
  showAction,
}: {
  item: PTGateItem;
  attempt: PTGateAttempt;
  reason: string | null;
  onSolve: () => void;
  showAction: boolean;
}) {
  const right = item.correct === true;
  const title = item.right_pattern?.title ?? "";
  // Mid-sentence: "Yes, longest valid window" (sentence case, rules/frontend.md 7).
  const rightTitle = title.charAt(0).toLowerCase() + title.slice(1);
  return (
    <section className={`pt-panel pt-gate-result is-${right ? "right" : "missed"}`} aria-labelledby="pt-gate-verdict">
      <h2 id="pt-gate-verdict" className="pt-gate-verdict">
        {right ? <CheckCircleIcon size={22} /> : <CrossCircleIcon size={22} />}
        <span>{right ? `Yes, ${rightTitle}` : `Not quite: this is ${rightTitle}`}</span>
      </h2>
      {!right ? <p>You picked {patternTitle(attempt, item.picked_key)}. Here is the cue that pointed the other way.</p> : null}
      {item.cue ? (
        <p className="pt-gate-cue">
          <b>{right ? "Cue you caught" : "Missed cue"}</b>
          {item.cue}
        </p>
      ) : null}
      {reason ? (
        <p className="pt-gate-reason-echo">
          <b>Your reason</b>
          {reason}
        </p>
      ) : null}
      {item.kojo_note ? (
        <p className="pt-gate-note">
          <b>Kojo</b>
          {item.kojo_note}
        </p>
      ) : null}
      {showAction ? (
        <div className="pt-gate-result-actions">
          <Button onClick={onSolve}>{right ? "Open the editor" : "Solve it anyway"}</Button>
          <span className="muted small">
            {right ? "Solve it to move on." : "Recognition counts as missed. The solve is scored on its own."}
          </span>
        </div>
      ) : null}
    </section>
  );
}

function GateEnd({ attempt }: { attempt: PTGateAttempt }) {
  const navigate = useNavigate();
  const passed = attempt.passed === true;
  const missed = [...attempt.items].sort((a, b) => a.position - b.position);
  return (
    <div className="pt-gate-end">
      <section className={`pt-panel pt-gate-score is-${passed ? "passed" : "failed"}`} aria-labelledby="pt-gate-score-title">
        {passed ? <YarnBall size={56} /> : <SummitIcon size={40} />}
        <div>
          <h2 id="pt-gate-score-title">{passed ? `${attempt.topic_title} cleared` : reopensIn(attempt.locked_until)}</h2>
          <p>
            <strong>
              {attempt.correct_count} of {attempt.items.length}
            </strong>{" "}
            picked right{passed ? "." : `, ${attempt.need} needed. The next try draws a new mix.`}
          </p>
        </div>
        <div className="pt-gate-score-actions">
          <Button onClick={() => navigate("/pattern-trails")}>Back to the map</Button>
        </div>
      </section>
      <section className="pt-panel" aria-labelledby="pt-gate-recap-title">
        <h2 id="pt-gate-recap-title">Recap</h2>
        <ol className="pt-gate-recap">
          {missed.map((item) => (
            <li key={item.id} className={item.correct ? "is-right" : "is-missed"}>
              <span className="pt-gate-recap-mark" aria-hidden="true">
                {item.correct ? <CheckCircleIcon size={20} /> : <CrossCircleIcon size={20} />}
              </span>
              <span className="pt-gate-recap-text">
                <b>
                  Problem {item.position}: {item.right_pattern?.title}
                </b>
                <span className="sr-only">{item.correct ? "Picked right." : "Missed."}</span>
                {!item.correct ? (
                  <span>
                    You picked {patternTitle(attempt, item.picked_key)}. Missed cue: {item.cue}
                  </span>
                ) : null}
                {solveLine(item) ? <span className="muted">{solveLine(item)}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function PatternTrailGate() {
  const { topicSlug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useMobileShell();
  const attemptId = Number(params.get("attempt")) || null;

  const [intro, setIntro] = useState<Intro | null>(null);
  const [attempt, setAttempt] = useState<PTGateAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [problems, setProblems] = useState<Record<number, PTGateProblem>>({});
  const [problemError, setProblemError] = useState<string | null>(null);
  const [problemReload, setProblemReload] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [checking, setChecking] = useState(false);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [announce, setAnnounce] = useState("");
  const handBackDone = useRef(false);

  const turn = attempt ? currentTurn(attempt) : null;
  usePageTour("pattern-trail-gate", Boolean(turn && turn.phase === "pick"));

  // The editor hands back a gate solve: say how it went, once.
  useEffect(() => {
    if (handBackDone.current) return;
    const back = readGateSolve(location.state);
    if (!back) return;
    handBackDone.current = true;
    if (back.solved && !back.slow) toast.success("Solve saved");
    else if (back.solved) toast.info("Solved, a little slow", back.redoDueAt ? `It comes back ${dueIn(back.redoDueAt)} as a redo.` : undefined);
    else toast.info("Saved", back.redoDueAt ? `It comes back ${dueIn(back.redoDueAt)} as a redo.` : "It comes back as a redo.");
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);

  // Load: an attempt in the URL, else the map's gate state for this topic.
  useEffect(() => {
    let live = true;
    setError(null);
    const fail = (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load the gate.");
    if (attemptId) {
      fetchTrailGateAttempt(attemptId)
        .then((a) => live && setAttempt(a))
        .catch(fail);
    } else {
      setAttempt(null);
      fetchTrailMap()
        .then((map) => {
          if (!live) return;
          const topic = map.topics.find((t) => t.slug === topicSlug);
          if (!topic) {
            setError("This land does not exist.");
            return;
          }
          if (topic.gate.state === "in_progress" && topic.gate.attempt_id) {
            setParams({ attempt: String(topic.gate.attempt_id) }, { replace: true });
            return;
          }
          setIntro({ title: topic.title, gate: topic.gate });
        })
        .catch(fail);
    }
    return () => {
      live = false;
    };
  }, [attemptId, topicSlug, reload, setParams]);

  // The statement for the problem in hand (kept per item, so going back is instant).
  const itemId = turn?.item.id ?? null;
  useEffect(() => {
    if (!attempt || itemId == null || problems[itemId]) return;
    let live = true;
    setProblemError(null);
    fetchTrailGateProblem(attempt.attempt_id, itemId)
      .then((p) => live && setProblems((m) => ({ ...m, [itemId]: p })))
      .catch((e: unknown) => live && setProblemError(e instanceof Error ? e.message : "Could not load this problem."));
    return () => {
      live = false;
    };
    // problems is read only to skip a fetch already done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.attempt_id, itemId, problemReload]);

  // A new problem starts with a clean form.
  useEffect(() => {
    setPicked(null);
    setReason("");
  }, [itemId]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const a = await startTrailGate(topicSlug);
      setAttempt(a);
      setParams({ attempt: String(a.attempt_id) }, { replace: true });
    } catch (e) {
      toast.error("The gate did not open", e instanceof Error ? e.message : undefined);
    } finally {
      setStarting(false);
    }
  }, [topicSlug, setParams]);

  const check = reasonCheck(reason);
  const canCheck = Boolean(picked) && check.ok && !checking;

  const submitPick = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!attempt || !turn || turn.phase !== "pick" || !picked || !check.ok || checking) return;
    const id = turn.item.id;
    const text = reason.trim();
    setChecking(true);
    setAnnounce("Checking your pick");
    try {
      const res = await pickTrailGate(attempt.attempt_id, { item_id: id, picked_key: picked, reason: text });
      setReasons((m) => ({ ...m, [id]: text }));
      setAttempt(res.attempt);
      setAnnounce(
        res.correct
          ? `Right, ${res.right_pattern.title}. ${progressLine(res.attempt)}.`
          : `Not quite, this is ${res.right_pattern.title}. ${progressLine(res.attempt)}.`,
      );
    } catch (err) {
      setAnnounce("");
      toast.error("Kojo could not check that pick", err instanceof Error ? err.message : undefined);
      // A pick that already landed (409) shows up on a fresh read.
      fetchTrailGateAttempt(attempt.attempt_id).then(setAttempt).catch(() => undefined);
    } finally {
      setChecking(false);
    }
  };

  const openEditor = () => {
    if (attempt && turn) navigate(gateEditorUrl(attempt.attempt_id, turn.item.id, attempt.topic_slug));
  };

  const header = (title: string) => (
    <>
      <Link to="/pattern-trails" className="pt-back">
        <ChevronLeftIcon size={16} /> Pattern trails
      </Link>
      <div className="pt-gate-head" data-tour="pt-gate-title">
        <div>
          <h1>{title} gate</h1>
          <p className="muted">Unlabeled problems, mixed with patterns you have walked. Name the technique before you solve.</p>
        </div>
        {attempt ? (
          <div className="pt-gate-progress">
            <GateDots attempt={attempt} current={turn?.item.id ?? null} />
            <span>{progressLine(attempt)}</span>
          </div>
        ) : null}
      </div>
    </>
  );

  if (error) {
    return (
      <div className="page pt-page pt-gate-page">
        <EmptyState
          icon={<AlertIcon size={22} />}
          title="The gate did not load"
          body={error}
          action={<Button onClick={() => setReload((n) => n + 1)}>Try again</Button>}
        />
      </div>
    );
  }

  // ── Before an attempt: locked, cooling down, or ready to start ──
  if (!attempt) {
    if (!intro) return <SkeletonTrailGate />;
    const { gate } = intro;
    let body: ReactNode;
    if (gate.state === "locked") {
      body = (
        <EmptyState
          icon={<SummitIcon size={22} />}
          title="Walk every path first"
          body={`The gate opens after every path in ${intro.title} is finished.`}
          action={<Button onClick={() => navigate("/pattern-trails")}>Back to the map</Button>}
        />
      );
    } else if (gate.state === "cooldown") {
      body = (
        <EmptyState
          icon={<SummitIcon size={22} />}
          title={reopensIn(gate.locked_until)}
          body={`Last try: ${gate.best_correct ?? 0} of ${gate.size} picked right, ${gate.need} needed. The next try draws a new mix.`}
          action={<Button onClick={() => navigate("/pattern-trails")}>Back to the map</Button>}
        />
      );
    } else {
      body = (
        <section className="pt-panel pt-gate-intro" aria-labelledby="pt-gate-intro-title">
          <h2 id="pt-gate-intro-title">{gate.cleared ? "Walk the gate again" : "How the gate works"}</h2>
          <ol className="pt-gate-rules">
            <li>
              {gate.size} problems with no title or tags, some from {intro.title}, some from patterns you know.
            </li>
            <li>Pick the technique and write one line on what gave it away. Kojo reads your reason.</li>
            <li>Then solve it in the editor. The solve is scored on its own.</li>
            <li>
              Pick {gate.need} of {gate.size} right to clear the gate. A miss reopens it after 24 hours with a new mix.
            </li>
          </ol>
          <div className="pt-panel-actions">
            <Button onClick={start} disabled={starting}>
              {starting ? "Opening the gate" : "Start the gate"}
            </Button>
            {starting ? <InlineLoading label="Drawing 5 problems" /> : null}
          </div>
        </section>
      );
    }
    return (
      <div className="page pt-page pt-gate-page">
        {header(intro.title)}
        {body}
      </div>
    );
  }

  // ── Every problem picked and solved ──
  if (!turn) {
    return (
      <div className="page pt-page pt-gate-page">
        {header(attempt.topic_title)}
        <GateEnd attempt={attempt} />
      </div>
    );
  }

  const item = turn.item;
  const problem = problems[item.id] ?? null;
  const reasonId = `pt-gate-reason-${item.id}`;

  const pickForm = (
    <form className="pt-panel pt-gate-pick" onSubmit={submitPick} id="pt-gate-form" aria-labelledby="pt-gate-pick-title">
      <fieldset className="pt-gate-options" data-tour="pt-gate-pick" disabled={checking}>
        <legend id="pt-gate-pick-title">Pick the pattern</legend>
        {attempt.options.map((o) => (
          <label key={o.key} className={`pt-gate-option${picked === o.key ? " is-picked" : ""}`}>
            <input
              type="radio"
              name={`pt-gate-pick-${item.id}`}
              value={o.key}
              checked={picked === o.key}
              onChange={() => setPicked(o.key)}
            />
            <span>{o.title}</span>
          </label>
        ))}
      </fieldset>
      <div className="pt-gate-reason" data-tour="pt-gate-reason">
        <TextInput
          id={reasonId}
          label="One line: what in the problem told you?"
          value={reason}
          maxLength={REASON_MAX}
          disabled={checking}
          onChange={(e) => setReason(e.target.value)}
          placeholder="The words or limits that gave it away"
          aria-describedby={`${reasonId}-hint`}
          autoComplete="off"
        />
        <span id={`${reasonId}-hint`} className={`pt-gate-hint${check.ok ? "" : " is-short"}`}>
          {picked ? check.hint : check.ok ? "Pick a pattern above" : check.hint}
        </span>
      </div>
      {!mobile ? (
        <div className="pt-panel-actions">
          <Button type="submit" disabled={!canCheck}>
            {checking ? "Checking" : "Check my pick"}
          </Button>
          {checking ? <InlineLoading label="Kojo is reading your reason" /> : null}
        </div>
      ) : checking ? (
        <InlineLoading label="Kojo is reading your reason" />
      ) : null}
    </form>
  );

  const action =
    turn.phase === "pick" ? (
      <Button type="submit" form="pt-gate-form" disabled={!canCheck}>
        {checking ? "Checking" : "Check my pick"}
      </Button>
    ) : (
      <Button onClick={openEditor}>{item.correct ? "Open the editor" : "Solve it anyway"}</Button>
    );

  return (
    <div className={`page pt-page pt-gate-page${mobile ? " has-quest-bar" : ""}`}>
      {header(attempt.topic_title)}
      <div className="pt-gate-grid">
        <ProblemPanel
          item={item}
          attempt={attempt}
          problem={problem}
          error={problemError}
          onRetry={() => setProblemReload((n) => n + 1)}
        />
        <div className="pt-gate-side">
          {turn.phase === "pick" ? (
            pickForm
          ) : (
            <PickResult
              item={item}
              attempt={attempt}
              reason={reasons[item.id] ?? null}
              onSolve={openEditor}
              showAction={!mobile}
            />
          )}
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {mobile ? (
        <div className="pt-quest-bar">
          <span className="pt-quest-bar-text">
            <b>{problemLabel(item, attempt)}</b>
            <span>{turn.phase === "pick" ? (picked ? check.hint : "Pick a pattern") : progressLine(attempt)}</span>
          </span>
          {action}
        </div>
      ) : null}
    </div>
  );
}
