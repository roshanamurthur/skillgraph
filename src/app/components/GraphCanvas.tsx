"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import { v4 as uuid } from "uuid";
import type { Skill, SkillNodeData } from "@/lib/types";
import { loadSkills, saveSkill, saveAllSkills } from "@/lib/store";
import SkillNode from "./SkillNode";
import DetailPanel from "./DetailPanel";

const nodeTypes = { skill: SkillNode };

const H_SPACING = 180;
const V_SPACING = 160;

function computeDepths(skills: Skill[]): Map<string, number> {
  const depths = new Map<string, number>();
  const byId = new Map(skills.map((s) => [s.id, s]));

  function getDepth(id: string): number {
    if (depths.has(id)) return depths.get(id)!;
    const skill = byId.get(id);
    if (!skill || !skill.parentId) {
      depths.set(id, 0);
      return 0;
    }
    const d = getDepth(skill.parentId) + 1;
    depths.set(id, d);
    return d;
  }

  for (const s of skills) getDepth(s.id);
  return depths;
}

function layoutNodes(skills: Skill[]): Node[] {
  const childrenMap = new Map<string | null, Skill[]>();
  for (const s of skills) {
    const list = childrenMap.get(s.parentId) ?? [];
    list.push(s);
    childrenMap.set(s.parentId, list);
  }

  const nodes: Node[] = [];
  const widths = new Map<string, number>();
  const depths = computeDepths(skills);

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

  for (const s of skills) subtreeWidth(s.id);

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
      data: { skill, depth: depths.get(skill.id) ?? 0 } satisfies SkillNodeData,
    });

    const children = childrenMap.get(id) ?? [];
    let offset = leftOffset;
    for (const child of children) {
      place(child.id, depth + 1, offset);
      offset += widths.get(child.id) ?? 1;
    }
  }

  const roots = childrenMap.get(null) ?? [];
  let offset = 0;
  for (const root of roots) {
    place(root.id, 0, offset);
    offset += widths.get(root.id) ?? 1;
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

  useEffect(() => {
    loadSkills().then((stored) => {
      if (stored.length > 0) {
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

  const onConnect = useCallback(
    (connection: Connection) => {
      // Create the visual edge
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            animated: true,
            style: { stroke: "var(--edge-color)", strokeWidth: 2 },
          },
          eds,
        ),
      );

      // Update the child skill's parentId to reflect the connection
      if (connection.source && connection.target) {
        const targetSkill = skills.find((s) => s.id === connection.target);
        if (targetSkill && targetSkill.parentId !== connection.source) {
          const updated = { ...targetSkill, parentId: connection.source };
          const next = skills.map((s) =>
            s.id === updated.id ? updated : s,
          );
          setSkills(next);
          saveSkill(updated);
          // Re-layout after connection to update depths
          setTimeout(() => syncGraph(next), 50);
        }
      }
    },
    [skills, setEdges, syncGraph],
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
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        connectOnClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="var(--graph-dot)" />
        <Controls showInteractive={false} className="graph-controls" />
        <MiniMap
          nodeColor="#22c55e"
          maskColor="rgba(0,0,0,0.7)"
          className="graph-minimap"
        />
      </ReactFlow>

      <button
        onClick={addSkill}
        className="add-node-btn"
        style={selectedSkill ? { right: 396 } : undefined}
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
