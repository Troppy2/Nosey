import { useEffect, useState } from "react";
import { fetchAdminTokenUsage } from "../lib/api";
import type { TokenUsageReport, TokenWeek } from "../lib/types";

// Series colors validated with the dataviz palette checker (light surface):
// lightness, chroma, CVD separation (deutan dE 29.6) and contrast all pass.
const INPUT_COLOR = "#5b8a2e";
const OUTPUT_COLOR = "#4a3aa7";

const CHART_W = 720;
const CHART_H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 48 };

const PROVIDER_NAMES: Record<string, string> = {
  groq: "Groq",
  claude: "Claude (Anthropic)",
  gemini: "Gemini",
  ollama: "Ollama",
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function formatCost(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

function formatWeek(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatFeature(feature: string): string {
  return feature.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

function WeeklyChart({ weeks }: { weeks: TokenWeek[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const yMax = niceMax(Math.max(...weeks.map((w) => w.total_tokens)));
  const slot = plotW / weeks.length;
  const barW = Math.min(36, slot * 0.62);
  const y = (value: number) => PAD.top + plotH - (value / yMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const hovered = hover === null ? null : weeks[hover];

  return (
    <div className="token-chart">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="token-chart-svg"
        role="img"
        aria-label="Tokens per week, last 12 weeks, split into input and output"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className={tick === 0 ? "token-chart-baseline" : "token-chart-grid"}
            />
            <text x={PAD.left - 8} y={y(tick)} className="token-chart-axis" textAnchor="end" dominantBaseline="middle">
              {formatTokens(tick)}
            </text>
          </g>
        ))}
        {weeks.map((week, index) => {
          const cx = PAD.left + slot * index + slot / 2;
          const x = cx - barW / 2;
          const inputTop = y(week.input_tokens);
          const outputTop = y(week.total_tokens);
          const inputH = PAD.top + plotH - inputTop;
          // 2px surface gap between the stacked segments.
          const outputH = Math.max(0, inputTop - outputTop - (week.input_tokens > 0 ? 2 : 0));
          const dim = hover !== null && hover !== index;
          return (
            <g key={week.week_start} opacity={dim ? 0.45 : 1}>
              {inputH > 0 ? (
                <path
                  d={roundedTop(x, inputTop, barW, inputH, week.output_tokens > 0 ? 0 : 4)}
                  fill={INPUT_COLOR}
                />
              ) : null}
              {outputH > 0 ? <path d={roundedTop(x, outputTop, barW, outputH, 4)} fill={OUTPUT_COLOR} /> : null}
              {index % 2 === weeks.length % 2 || index === weeks.length - 1 ? (
                <text x={cx} y={CHART_H - 8} className="token-chart-axis" textAnchor="middle">
                  {index === weeks.length - 1 ? "This week" : formatWeek(week.week_start)}
                </text>
              ) : null}
              {/* Hit target: the whole column, wider and taller than the mark. */}
              <rect
                x={PAD.left + slot * index}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`Week of ${formatWeek(week.week_start)}: ${week.total_tokens.toLocaleString()} tokens`}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null ? (
        <div
          className="token-chart-tooltip"
          style={{ left: `${((PAD.left + slot * hover + slot / 2) / CHART_W) * 100}%` }}
          role="status"
        >
          <p className="token-chart-tooltip-title">
            Week of {formatWeek(hovered.week_start)}
          </p>
          <p>
            <span className="token-swatch" style={{ background: INPUT_COLOR }} />
            Input <strong>{hovered.input_tokens.toLocaleString()}</strong>
          </p>
          <p>
            <span className="token-swatch" style={{ background: OUTPUT_COLOR }} />
            Output <strong>{hovered.output_tokens.toLocaleString()}</strong>
          </p>
          <p className="token-chart-tooltip-foot">
            {hovered.total_tokens.toLocaleString()} tokens, est. {formatCost(hovered.cost_usd)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// A bar with only its top corners rounded, anchored to the baseline.
function roundedTop(x: number, top: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  const bottom = top + h;
  return [
    `M${x},${bottom}`,
    `V${top + radius}`,
    `Q${x},${top} ${x + radius},${top}`,
    `H${x + w - radius}`,
    `Q${x + w},${top} ${x + w},${top + radius}`,
    `V${bottom}`,
    "Z",
  ].join(" ");
}

function BreakdownTable({
  title,
  rows,
  label,
  nameOf,
}: {
  title: string;
  rows: Array<{ key: string; total_tokens: number; input_tokens: number; output_tokens: number; cost_usd: number; calls: number; unpriced_calls: number }>;
  label: string;
  nameOf: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.total_tokens));
  return (
    <div className="token-breakdown">
      <h3 className="token-breakdown-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="muted small">No LLM calls yet this week.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{label}</th>
                <th>Tokens</th>
                <th style={{ width: "40%" }} aria-label="Share" />
                <th>Est. cost</th>
                <th>Calls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{nameOf(row.key)}</td>
                  <td className="admin-cell-count" title={`${row.input_tokens.toLocaleString()} in / ${row.output_tokens.toLocaleString()} out`}>
                    {formatTokens(row.total_tokens)}
                  </td>
                  <td>
                    <div className="admin-activity-bar-wrap">
                      <div
                        className="token-share-bar"
                        style={{ width: `${Math.max(2, (row.total_tokens / max) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td>
                    {formatCost(row.cost_usd)}
                    {row.unpriced_calls > 0 ? <span className="muted small" title="Model has no price entry"> + unpriced</span> : null}
                  </td>
                  <td>{row.calls.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminTokenUsage() {
  const [report, setReport] = useState<TokenUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAdminTokenUsage()
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load token usage.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="admin-section">
        <h2 className="admin-section-title">Token usage</h2>
        <p className="admin-error">Token usage failed to load: {error}</p>
      </section>
    );
  }
  if (!report) {
    return (
      <section className="admin-section">
        <h2 className="admin-section-title">Token usage</h2>
        <div className="token-loading" aria-busy="true" />
      </section>
    );
  }

  const trendTotal = report.weeks.reduce((sum, w) => sum + w.total_tokens, 0);
  const estimatedCalls = report.this_week.estimated_calls;

  return (
    <section className="admin-section token-usage">
      <div className="token-usage-head">
        <h2 className="admin-section-title">Token usage</h2>
        <p className="muted small">Weeks run Monday to Sunday (UTC). Costs are estimates from list prices; Ollama counts as free.</p>
      </div>

      <div className="token-tiles">
        <div className="token-tile">
          <p className="token-tile-label">This week so far</p>
          <p className="token-tile-value">{formatTokens(report.this_week.total_tokens)}</p>
          <p className="token-tile-sub">est. {formatCost(report.this_week.cost_usd)}, {report.this_week.calls.toLocaleString()} calls</p>
        </div>
        <div className="token-tile">
          <p className="token-tile-label">Last 7 days</p>
          <p className="token-tile-value">{formatTokens(report.last_7_days.total_tokens)}</p>
          <p className="token-tile-sub">est. {formatCost(report.last_7_days.cost_usd)}</p>
        </div>
        <div className="token-tile">
          <p className="token-tile-label">Weekly average (12 weeks)</p>
          <p className="token-tile-value">{formatTokens(Math.round(trendTotal / report.weeks.length))}</p>
          <p className="token-tile-sub">
            est. {formatCost(report.weeks.reduce((sum, w) => sum + w.cost_usd, 0) / report.weeks.length)} per week
          </p>
        </div>
      </div>

      <div className="token-chart-card">
        <div className="token-chart-toolbar">
          <div className="token-legend" aria-label="Legend">
            <span><span className="token-swatch" style={{ background: INPUT_COLOR }} />Input</span>
            <span><span className="token-swatch" style={{ background: OUTPUT_COLOR }} />Output</span>
          </div>
          <button type="button" className="token-view-toggle" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>
        {trendTotal === 0 ? (
          <p className="muted small token-empty">No token usage recorded in the last 12 weeks.</p>
        ) : showTable ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Total</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {[...report.weeks].reverse().map((week) => (
                  <tr key={week.week_start}>
                    <td className="admin-cell-date">{formatWeek(week.week_start)}</td>
                    <td>{week.input_tokens.toLocaleString()}</td>
                    <td>{week.output_tokens.toLocaleString()}</td>
                    <td>{week.total_tokens.toLocaleString()}</td>
                    <td>{formatCost(week.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <WeeklyChart weeks={report.weeks} />
        )}
      </div>

      <div className="token-breakdowns">
        <BreakdownTable
          title="This week by feature"
          label="Feature"
          rows={report.by_feature.map((r) => ({ key: r.feature, ...r }))}
          nameOf={formatFeature}
        />
        <BreakdownTable
          title="This week by provider"
          label="Provider"
          rows={report.by_provider.map((r) => ({ key: r.provider, ...r }))}
          nameOf={(p) => PROVIDER_NAMES[p] ?? p}
        />
      </div>

      {estimatedCalls > 0 ? (
        <p className="muted small">
          {estimatedCalls.toLocaleString()} call{estimatedCalls === 1 ? "" : "s"} this week ended before the provider
          reported usage; their tokens are estimated from text length.
        </p>
      ) : null}
    </section>
  );
}
