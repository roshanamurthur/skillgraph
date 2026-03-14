"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SkillNodeData } from "@/lib/types";

const DEPTH_COLORS = [
  "#22c55e", // 0 — green (root)
  "#6366f1", // 1 — indigo
  "#a855f7", // 2 — purple
  "#ec4899", // 3 — pink
  "#f59e0b", // 4 — amber
  "#06b6d4", // 5 — cyan
  "#ef4444", // 6 — red
  "#84cc16", // 7 — lime
];

function colorForDepth(depth: number): string {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length];
}

export default function SkillNode({ data, selected }: NodeProps) {
  const { skill, depth } = data as SkillNodeData;
  const color = colorForDepth(depth);
  const hasFiles = skill.files.length > 0;

  return (
    <div
      className="skill-circle"
      style={{
        borderColor: selected ? "#fff" : color,
        boxShadow: selected
          ? `0 0 0 2px #fff, 0 0 20px ${color}80`
          : `0 0 16px ${color}40`,
        background: `radial-gradient(circle at 35% 35%, ${color}30, ${color}10 70%, transparent)`,
      }}
    >
      <Handle type="target" position={Position.Top} className="circle-handle" />

      <div
        className="skill-circle-dot"
        style={{ backgroundColor: color }}
      />

      {hasFiles && (
        <div className="skill-circle-files" style={{ borderColor: color }}>
          {skill.files.length}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="circle-handle" />
    </div>
  );
}
