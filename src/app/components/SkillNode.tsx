"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SkillNodeData } from "@/lib/types";

function scoreColor(score: number): string {
  if (score >= 0.7) return "#22c55e";
  if (score >= 0.4) return "#f59e0b";
  return "#ef4444";
}

export default function SkillNode({ data }: NodeProps) {
  const { skill } = data as SkillNodeData;

  return (
    <div className="skill-node">
      <Handle type="target" position={Position.Top} className="skill-handle" />

      <div className="skill-node-header">
        <span className="skill-node-name">{skill.name}</span>
        <div className="skill-node-header-right">
          {skill.files.length > 0 && (
            <span className="skill-node-file-count" title={`${skill.files.length} file(s)`}>
              {skill.files.length}
            </span>
          )}
          <span className="skill-node-version">v{skill.version}</span>
        </div>
      </div>

      <span className="skill-node-model">{skill.model}</span>

      {skill.score !== null && (
        <div className="skill-node-score-track">
          <div
            className="skill-node-score-bar"
            style={{
              width: `${skill.score * 100}%`,
              backgroundColor: scoreColor(skill.score),
            }}
          />
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="skill-handle"
      />
    </div>
  );
}
