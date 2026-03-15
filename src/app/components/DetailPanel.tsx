"use client";

import { useCallback, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import type { Skill, SkillFile } from "@/lib/types";
import { createSkillFile } from "@/lib/parser";
import BenchmarkSection from "./BenchmarkSection";

interface DetailPanelProps {
  skill: Skill;
  onClose: () => void;
  onUpdateSkill: (skill: Skill) => void;
  onDeleteSkill: (id: string, mode: "subtree" | "reparent") => void;
  onRefreshGraph?: () => void;
}

function FileTypeIcon({ type }: { type: SkillFile["type"] }) {
  const labels: Record<SkillFile["type"], string> = {
    skill: "SK",
    json: "{}",
    yaml: "YM",
    text: "TX",
  };
  return <span className="file-type-badge">{labels[type]}</span>;
}

function FilePreview({ file }: { file: SkillFile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="file-item">
      <button
        className="file-item-header"
        onClick={() => setExpanded(!expanded)}
      >
        <FileTypeIcon type={file.type} />
        <span className="file-item-name">{file.name}</span>
        <span className="file-item-toggle">{expanded ? "\u25B4" : "\u25BE"}</span>
      </button>

      {expanded && (
        <div className="file-item-content">
          {file.parsed ? (
            <>
              {Object.keys(file.parsed.frontmatter).length > 0 && (
                <div className="file-frontmatter">
                  <div className="file-section-label">Metadata</div>
                  <div className="file-meta-grid">
                    {Object.entries(file.parsed.frontmatter).map(
                      ([key, val]) => (
                        <div key={key} className="file-meta-row">
                          <span className="file-meta-key">{key}</span>
                          <span className="file-meta-val">
                            {typeof val === "object"
                              ? JSON.stringify(val)
                              : String(val)}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
              {file.parsed.body && (
                <div className="file-body">
                  <div className="file-section-label">Content</div>
                  <pre className="file-body-pre">{file.parsed.body}</pre>
                </div>
              )}
            </>
          ) : (
            <pre className="file-body-pre">{file.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function DetailPanel({
  skill,
  onClose,
  onUpdateSkill,
  onDeleteSkill,
  onRefreshGraph,
}: DetailPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeStatus, setOptimizeStatus] = useState<string | null>(null);

  const handleOptimize = useCallback(async () => {
    if (optimizing) return;
    setOptimizing(true);
    setOptimizeStatus("Starting optimization...");
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: skill.id }),
      });
      if (!res.ok) throw new Error("Failed to start optimization");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          switch (event.type) {
            case "errors_ranked":
              setOptimizeStatus(`Ranked ${event.errors.length} error categories`);
              break;
            case "generating_hypotheses":
              setOptimizeStatus(`Generating hypotheses for ${event.category}...`);
              break;
            case "hypotheses_generated":
              setOptimizeStatus(`Generated ${event.hypotheses.length} hypotheses`);
              break;
            case "variant_created":
              setOptimizeStatus(`Created variant: ${event.hypothesis.description.slice(0, 50)}...`);
              onRefreshGraph?.();
              break;
            case "variant_benchmarking":
              setOptimizeStatus("Benchmarking variants...");
              break;
            case "iteration_complete":
              setOptimizeStatus(`Completed ${event.category}: winner selected, ${event.prunedIds.length} pruned`);
              onRefreshGraph?.();
              break;
            case "completed":
              setOptimizeStatus(`Optimization complete! Best score: ${Math.round(event.bestScore * 100)}%`);
              onRefreshGraph?.();
              break;
            case "error":
              setOptimizeStatus(`Error: ${event.message}`);
              break;
          }
        }
      }
    } catch (err) {
      setOptimizeStatus(
        `Failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setOptimizing(false);
    }
  }, [skill.id, optimizing, onRefreshGraph]);

  const handleFiles = useCallback(
    (fileList: FileList) => {
      const readers = Array.from(fileList).map(
        (f) =>
          new Promise<SkillFile>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve(
                createSkillFile(uuid(), f.name, reader.result as string),
              );
            };
            reader.readAsText(f);
          }),
      );

      Promise.all(readers).then((newFiles) => {
        onUpdateSkill({
          ...skill,
          files: [...skill.files, ...newFiles],
        });
      });
    },
    [skill, onUpdateSkill],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const removeFile = useCallback(
    (fileId: string) => {
      onUpdateSkill({
        ...skill,
        files: skill.files.filter((f) => f.id !== fileId),
      });
    },
    [skill, onUpdateSkill],
  );

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <div className="detail-panel-title-row">
          <h2 className="detail-panel-title">{skill.name}</h2>
          <div className="detail-panel-badges">
            <span className="skill-node-version">v{skill.version}</span>
            <span className="detail-panel-model">{skill.model}</span>
          </div>
        </div>
        <div className="detail-panel-actions">
          <button
            className="detail-panel-delete"
            onClick={() => setConfirmDelete(!confirmDelete)}
            title="Delete skill"
          >
            &#128465;
          </button>
          <button className="detail-panel-close" onClick={onClose}>
            &times;
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="delete-confirm">
          <span className="delete-confirm-label">Delete this skill?</span>
          <div className="delete-confirm-buttons">
            <button
              className="delete-confirm-btn delete-subtree"
              onClick={() => onDeleteSkill(skill.id, "subtree")}
            >
              Delete subtree
            </button>
            <button
              className="delete-confirm-btn delete-reparent"
              onClick={() => onDeleteSkill(skill.id, "reparent")}
            >
              Delete node only
            </button>
            <button
              className="delete-confirm-btn delete-cancel"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {skill.score !== null && (
        <div className="detail-panel-score">
          <span className="detail-panel-score-label">Score</span>
          <div className="skill-node-score-track" style={{ flex: 1 }}>
            <div
              className="skill-node-score-bar"
              style={{
                width: `${skill.score * 100}%`,
                backgroundColor:
                  skill.score >= 0.7
                    ? "#22c55e"
                    : skill.score >= 0.4
                      ? "#f59e0b"
                      : "#ef4444",
              }}
            />
          </div>
          <span className="detail-panel-score-val">
            {(skill.score * 100).toFixed(0)}%
          </span>
        </div>
      )}

      <div className="detail-panel-meta">
        <div className="file-meta-row">
          <span className="file-meta-key">ID</span>
          <span className="file-meta-val detail-mono">
            {skill.id.slice(0, 8)}
          </span>
        </div>
        <div className="file-meta-row">
          <span className="file-meta-key">Created</span>
          <span className="file-meta-val">
            {new Date(skill.createdAt).toLocaleDateString()}
          </span>
        </div>
        {skill.parentId && (
          <div className="file-meta-row">
            <span className="file-meta-key">Parent</span>
            <span className="file-meta-val detail-mono">
              {skill.parentId.slice(0, 8)}
            </span>
          </div>
        )}
      </div>

      {/* Pruned badge */}
      {skill.status === "pruned" && (
        <div className="pruned-badge">
          Pruned
          {skill.targetCriteria && (
            <span className="pruned-criteria"> — lost on {skill.targetCriteria}</span>
          )}
        </div>
      )}

      {/* Hypothesis info (for hypothesis-generated nodes) */}
      {skill.hypothesis && (
        <div className="detail-panel-section hypothesis-section">
          <div className="detail-panel-section-header">
            <span>Hypothesis</span>
          </div>
          <div className="hypothesis-content">
            <p className="hypothesis-description">{skill.hypothesis}</p>
            {skill.changeSummary && (
              <div className="hypothesis-change">
                <span className="hypothesis-change-label">Change:</span>
                <span>{skill.changeSummary}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Optimize button */}
      {skill.status !== "pruned" && (
        <div className="detail-panel-section">
          <button
            className="optimize-btn"
            onClick={handleOptimize}
            disabled={optimizing || skill.files.length === 0}
          >
            {optimizing ? "Optimizing..." : "Optimize"}
          </button>
          {optimizeStatus && (
            <div className="optimize-status">{optimizeStatus}</div>
          )}
        </div>
      )}


      {/* Benchmark Section */}
      <BenchmarkSection skill={skill} onUpdateSkill={onUpdateSkill} />

      {/* Files Section */}
      <div className="detail-panel-section">
        <div className="detail-panel-section-header">
          <span>
            Files{" "}
            {skill.files.length > 0 && (
              <span className="file-count-inline">{skill.files.length}</span>
            )}
          </span>
        </div>

        <div
          className={`drop-zone ${dragOver ? "drop-zone-active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="drop-zone-icon">&uarr;</span>
          <span>Drop skill files here or click to browse</span>
          <span className="drop-zone-hint">
            .md .json .yaml .yml .txt .skill
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.json,.yaml,.yml,.txt,.skill"
            className="drop-zone-input"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {skill.files.length > 0 && (
          <div className="file-list">
            {skill.files.map((file) => (
              <div key={file.id} className="file-item-wrapper">
                <FilePreview file={file} />
                <button
                  className="file-remove-btn"
                  onClick={() => removeFile(file.id)}
                  title="Remove file"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
