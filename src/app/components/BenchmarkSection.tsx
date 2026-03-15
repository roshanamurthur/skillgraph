"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Skill, PyBenchmarkReport, PyBenchmarkCategory } from "@/lib/types";
import {
  fetchPyBenchmarkResults,
  triggerPyBenchmarkRun,
  pollPyBenchmarkRunStatus,
} from "@/lib/store/api-client";

interface BenchmarkSectionProps {
  skill: Skill;
  onUpdateSkill: (skill: Skill) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  student_calculations: "Student Calculations",
  assessment_stats: "Assessment Stats",
  overall_stats: "Overall Stats",
  advanced_metrics: "Advanced Metrics",
  boundary_cases: "Boundary Cases",
};

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.9 ? "#22c55e" : score >= 0.7 ? "#f59e0b" : "#ef4444";
  return (
    <div className="py-bm-score-bar">
      <span className="py-bm-score-bar-label">{label}</span>
      <div className="skill-node-score-track" style={{ flex: 1 }}>
        <div
          className="skill-node-score-bar"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="py-bm-score-bar-val">{pct}%</span>
    </div>
  );
}

function CategoryRow({
  name,
  cat,
}: {
  name: string;
  cat: PyBenchmarkCategory;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasFailed = cat.failed_checks.length > 0;

  return (
    <div className="py-bm-category">
      <button
        className="py-bm-category-header"
        onClick={() => hasFailed && setExpanded(!expanded)}
      >
        <span className="py-bm-category-name">
          {CATEGORY_LABELS[name] || name}
        </span>
        <span className="py-bm-category-fraction">{cat.fraction}</span>
        <div className="skill-node-score-track" style={{ width: 80 }}>
          <div
            className="skill-node-score-bar"
            style={{
              width: `${Math.round(cat.score * 100)}%`,
              backgroundColor:
                cat.score >= 0.9
                  ? "#22c55e"
                  : cat.score >= 0.7
                    ? "#f59e0b"
                    : "#ef4444",
            }}
          />
        </div>
        {hasFailed && (
          <span className="file-item-toggle">
            {expanded ? "\u25B4" : "\u25BE"}
          </span>
        )}
      </button>
      {expanded && (
        <div className="py-bm-failed-list">
          {cat.failed_checks.map((fc, i) => (
            <div key={i} className="py-bm-failed-check">
              <div className="py-bm-failed-check-name">{fc.check}</div>
              <div className="py-bm-failed-check-detail">
                <span className="py-bm-expected">
                  expected: {String(fc.expected)}
                </span>
                <span className="py-bm-actual">
                  actual: {String(fc.actual)}
                </span>
                {fc.delta != null && (
                  <span className="py-bm-delta">
                    delta: {fc.delta}
                  </span>
                )}
              </div>
              {fc.description && (
                <div className="py-bm-failed-check-desc">{fc.description}</div>
              )}
              {fc.cell && (
                <div className="py-bm-failed-check-loc">{fc.cell}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReasoningTrace({ trace, tokenUsage }: { trace: string; tokenUsage?: { input: number; output: number; reasoning: number } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="py-bm-trace">
      <button
        className="py-bm-trace-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          Reasoning Trace
          {tokenUsage && (
            <span className="py-bm-trace-tokens">
              {tokenUsage.reasoning > 0 ? ` (${tokenUsage.reasoning} reasoning tokens)` : ""}
            </span>
          )}
        </span>
        <span>{expanded ? "\u25B4" : "\u25BE"}</span>
      </button>
      {expanded && (
        <pre className="py-bm-trace-content">{trace}</pre>
      )}
    </div>
  );
}

function ReportView({ report }: { report: PyBenchmarkReport }) {
  const categoryEntries = Object.entries(report.categories);

  return (
    <div className="py-bm-report">
      <ScoreBar
        score={report.overall.score}
        label={report.overall.fraction}
      />

      <div className="py-bm-categories">
        {categoryEntries.map(([name, cat]) => (
          <CategoryRow key={name} name={name} cat={cat} />
        ))}
      </div>

      {report.error && (
        <div className="benchmark-error">{report.error}</div>
      )}

      {report.reasoning_trace && (
        <ReasoningTrace trace={report.reasoning_trace} tokenUsage={report.token_usage} />
      )}
    </div>
  );
}

export default function BenchmarkSection({
  skill,
  onUpdateSkill,
}: BenchmarkSectionProps) {
  const [reports, setReports] = useState<PyBenchmarkReport[]>([]);
  const [activeTest, setActiveTest] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const version = `v${skill.version}`;

  const loadResults = useCallback(async () => {
    try {
      const r = await fetchPyBenchmarkResults(version);
      setReports(r);
      if (r.length > 0 && !activeTest) {
        setActiveTest(r[0].test_input);
      }
      // Update score on skill from overall average
      if (r.length > 0) {
        const avgScore =
          r.reduce((sum, rep) => sum + rep.overall.score, 0) / r.length;
        if (skill.score !== avgScore) {
          onUpdateSkill({ ...skill, score: avgScore });
        }
      }
    } catch {
      // no results yet, that's fine
    }
  }, [version, activeTest, skill, onUpdateSkill]);

  useEffect(() => {
    loadResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setStatusMsg("Starting benchmark...");
    try {
      const { runId } = await triggerPyBenchmarkRun(version);
      setStatusMsg("Running benchmark...");

      pollRef.current = setInterval(async () => {
        try {
          const status = await pollPyBenchmarkRunStatus(runId);
          if (status.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setStatusMsg(null);
            setRunning(false);
            setActiveTest(null); // reset to pick first
            await loadResults();
          } else if (status.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setStatusMsg(null);
            setRunning(false);
            setError(status.error ?? "Benchmark run failed");
          }
        } catch {
          // poll error, keep trying
        }
      }, 5000);
    } catch (err) {
      setRunning(false);
      setStatusMsg(null);
      setError(err instanceof Error ? err.message : "Failed to trigger run");
    }
  }, [running, version, loadResults]);

  const activeReport = reports.find((r) => r.test_input === activeTest);

  return (
    <div className="detail-panel-section">
      <div className="detail-panel-section-header">
        <span>Benchmark {version}</span>
      </div>

      <div className="py-bm-controls">
        <button
          className="benchmark-run-btn"
          onClick={handleRun}
          disabled={running}
        >
          {running ? "Running..." : "Run Benchmark"}
        </button>
      </div>

      {statusMsg && <div className="py-bm-status">{statusMsg}</div>}
      {error && <div className="benchmark-error">{error}</div>}

      {reports.length > 0 && (
        <div className="py-bm-results">
          {/* Test input tabs */}
          <div className="py-bm-tabs">
            {reports.map((r) => (
              <button
                key={r.test_input}
                className={`py-bm-tab ${r.test_input === activeTest ? "py-bm-tab-active" : ""}`}
                onClick={() => setActiveTest(r.test_input)}
              >
                {r.test_input.replace(".csv", "")}
              </button>
            ))}
          </div>

          {activeReport && <ReportView report={activeReport} />}
        </div>
      )}
    </div>
  );
}
