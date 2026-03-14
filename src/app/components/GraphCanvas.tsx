"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import { v4 as uuid } from "uuid";
import type { Skill, SkillNodeData } from "@/lib/types";
import { loadSkills, saveSkill, saveAllSkills } from "@/lib/store";
import SkillNode from "./SkillNode";
import DetailPanel from "./DetailPanel";

const nodeTypes = { skill: SkillNode };

const H_SPACING = 260;
const V_SPACING = 140;

function layoutNodes(skills: Skill[]): Node[] {
  const childrenMap = new Map<string | null, Skill[]>();
  for (const s of skills) {
    const list = childrenMap.get(s.parentId) ?? [];
    list.push(s);
    childrenMap.set(s.parentId, list);
  }

  const nodes: Node[] = [];
  const widths = new Map<string, number>();

  function subtreeWidth(id: string): number {
    if (widths.has(id)) return widths.get(id)!;
    const children = childrenMap.get(id) ?? [];
    if (children.length === 0) {
      widths.set(id, 1);
      return 1;
    }
    const w = children.reduce((sum, c) => sum + subtreeWidth(c.id), 0);
    widths.set(id, w);
    return w;
  }

  for (const s of skills) {
    subtreeWidth(s.id);
  }

  function place(id: string, depth: number, leftOffset: number) {
    const skill = skills.find((s) => s.id === id);
    if (!skill) return;
    const w = widths.get(id) ?? 1;
    const x = (leftOffset + w / 2) * H_SPACING;
    const y = depth * V_SPACING;

    nodes.push({
      id: skill.id,
      type: "skill",
      position: { x, y },
      data: { skill } satisfies SkillNodeData,
    });

    const children = childrenMap.get(id) ?? [];
    let offset = leftOffset;
    for (const child of children) {
      place(child.id, depth + 1, offset);
      offset += (widths.get(child.id) ?? 1);
    }
  }

  const roots = childrenMap.get(null) ?? [];
  let offset = 0;
  for (const root of roots) {
    place(root.id, 0, offset);
    offset += (widths.get(root.id) ?? 1);
  }

  return nodes;
}

function deriveEdges(skills: Skill[]): Edge[] {
  return skills
    .filter((s) => s.parentId !== null)
    .map((s) => ({
      id: `e-${s.parentId}-${s.id}`,
      source: s.parentId!,
      target: s.id,
      type: "smoothstep",
      animated: true,
      style: { stroke: "var(--edge-color)", strokeWidth: 2 },
    }));
}

function makeSkill(parentId: string | null, version: number): Skill {
  return {
    id: uuid(),
    name: `Skill ${version}`,
    version,
    parentId,
    prompt: "",
    model: "claude-sonnet-4-6",
    score: null,
    files: [],
    createdAt: new Date().toISOString(),
  };
}

export default function GraphCanvas() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [counter, setCounter] = useState(1);
  const [loaded, setLoaded] = useState(false);

  // Load from IndexedDB on mount
  useEffect(() => {
    loadSkills().then((stored) => {
      if (stored.length > 0) {
        // Ensure old skills without files array still work
        const migrated = stored.map((s) => ({
          ...s,
          files: s.files ?? [],
        }));
        setSkills(migrated);
        setNodes(layoutNodes(migrated));
        setEdges(deriveEdges(migrated));
        const maxVersion = Math.max(...migrated.map((s) => s.version));
        setCounter(maxVersion + 1);
      }
      setLoaded(true);
    });
  }, [setNodes, setEdges]);

  const syncGraph = useCallback(
    (nextSkills: Skill[]) => {
      setSkills(nextSkills);
      setNodes(layoutNodes(nextSkills));
      setEdges(deriveEdges(nextSkills));
    },
    [setNodes, setEdges],
  );

  const addSkill = useCallback(() => {
    const parentId = selectedNodeId;
    const newSkill = makeSkill(parentId, counter);
    setCounter((c) => c + 1);
    const next = [...skills, newSkill];
    syncGraph(next);
    saveSkill(newSkill);
  }, [skills, selectedNodeId, counter, syncGraph]);

  const updateSkill = useCallback(
    (updated: Skill) => {
      const next = skills.map((s) => (s.id === updated.id ? updated : s));
      syncGraph(next);
      saveSkill(updated);
    },
    [skills, syncGraph],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const selectedSkill = selectedNodeId
    ? skills.find((s) => s.id === selectedNodeId) ?? null
    : null;

  if (!loaded) return null;

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--graph-dot)" />
        <Controls showInteractive={false} className="graph-controls" />
        <MiniMap
          nodeColor="var(--node-bg)"
          maskColor="rgba(0,0,0,0.6)"
          className="graph-minimap"
        />
      </ReactFlow>

      <button
        onClick={addSkill}
        className="add-node-btn"
        title={selectedNodeId ? "Add child node" : "Add root node"}
      >
        +
      </button>

      {selectedSkill && (
        <DetailPanel
          skill={selectedSkill}
          onClose={() => setSelectedNodeId(null)}
          onUpdateSkill={updateSkill}
        />
      )}
    </div>
  );
}
