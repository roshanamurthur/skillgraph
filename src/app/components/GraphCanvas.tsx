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
import { loadSkills, saveSkill, saveAllSkills, deleteSkill as deleteSkillIdb, clearAllSkills } from "@/lib/store";
import {
  fetchAllSkills,
  saveSkillToServer,
  deleteSkillFromServer,
  batchSaveSkills,
  resetAllSkills,
} from "@/lib/store/api-client";
import SkillNode from "./SkillNode";
import DetailPanel from "./DetailPanel";

const nodeTypes = { skill: SkillNode };

const H_SPACING = 180;
const V_SPACING = 160;

function computeDepths(skills: Skill[]): Map<string, number> {
  const depths = new Map<string, number>();
  const byId = new Map(skills.map((s) => [s.id, s]));
  const visiting = new Set<string>();

  function getDepth(id: string): number {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) return 0; // cycle detected
    visiting.add(id);
    const skill = byId.get(id);
    if (!skill || !skill.parentId) {
      depths.set(id, 0);
      visiting.delete(id);
      return 0;
    }
    const d = getDepth(skill.parentId) + 1;
    depths.set(id, d);
    visiting.delete(id);
    return d;
  }

  for (const s of skills) getDepth(s.id);
  return depths;
}

function recalcVersions(skills: Skill[]): Skill[] {
  const depths = computeDepths(skills);
  return skills.map((s) => ({
    ...s,
    version: (depths.get(s.id) ?? 0) + 1,
  }));
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

function makeSkill(parentId: string | null): Skill {
  return {
    id: uuid(),
    name: "Skill",
    version: 1, // placeholder — recalcVersions will fix it
    parentId,
    prompt: "",
    model: "o3-mini",
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchAllSkills()
      .then((serverSkills) => {
        if (serverSkills.length > 0) {
          const versioned = recalcVersions(
            serverSkills.map((s) => ({ ...s, files: s.files ?? [] })),
          );
          setSkills(versioned);
          setNodes(layoutNodes(versioned));
          setEdges(deriveEdges(versioned));
          // Sync to IndexedDB cache
          saveAllSkills(versioned);
        }
        setLoaded(true);
      })
      .catch(() => {
        // Fallback to IndexedDB
        loadSkills().then((stored) => {
          if (stored.length > 0) {
            const versioned = recalcVersions(
              stored.map((s) => ({ ...s, files: s.files ?? [] })),
            );
            setSkills(versioned);
            setNodes(layoutNodes(versioned));
            setEdges(deriveEdges(versioned));
          }
          setLoaded(true);
        });
      });
  }, [setNodes, setEdges]);

  const syncGraph = useCallback(
    (nextSkills: Skill[]) => {
      const versioned = recalcVersions(nextSkills);
      setSkills(versioned);
      setNodes(layoutNodes(versioned));
      setEdges(deriveEdges(versioned));
      return versioned;
    },
    [setNodes, setEdges],
  );

  const addSkill = useCallback(() => {
    const parentId = selectedNodeId;
    const newSkill = makeSkill(parentId);
    const next = [...skills, newSkill];
    const versioned = syncGraph(next);
    const savedSkill = versioned.find((s) => s.id === newSkill.id)!;
    saveSkillToServer(savedSkill).catch(() => {});
    saveSkill(savedSkill);
  }, [skills, selectedNodeId, syncGraph]);

  const updateSkill = useCallback(
    (updated: Skill) => {
      const next = skills.map((s) => (s.id === updated.id ? updated : s));
      const versioned = syncGraph(next);
      const savedSkill = versioned.find((s) => s.id === updated.id)!;
      saveSkillToServer(savedSkill).catch(() => {});
      saveSkill(savedSkill);
    },
    [skills, syncGraph],
  );

  const deleteSkillNode = useCallback(
    async (id: string, mode: "subtree" | "reparent") => {
      try {
        const result = await deleteSkillFromServer(id, mode);

        // Remove deleted skills from local state
        let next = skills.filter((s) => !result.deleted.includes(s.id));

        // Apply reparenting if applicable
        if (result.reparented && result.reparented.length > 0) {
          const target = skills.find((s) => s.id === id);
          const newParentId = target?.parentId ?? null;
          next = next.map((s) =>
            result.reparented!.includes(s.id)
              ? { ...s, parentId: newParentId }
              : s,
          );
        }

        const versioned = syncGraph(next);

        // Sync to IndexedDB + server
        for (const delId of result.deleted) {
          deleteSkillIdb(delId);
        }
        saveAllSkills(versioned);
        batchSaveSkills(versioned).catch(() => {});

        setSelectedNodeId(null);
      } catch {
        // Fallback: do it locally
        if (mode === "subtree") {
          const toDelete = new Set<string>();
          toDelete.add(id);
          const findDescendants = (parentId: string) => {
            for (const s of skills) {
              if (s.parentId === parentId) {
                toDelete.add(s.id);
                findDescendants(s.id);
              }
            }
          };
          findDescendants(id);
          const next = skills.filter((s) => !toDelete.has(s.id));
          const versioned = syncGraph(next);
          saveAllSkills(versioned);
          for (const delId of toDelete) deleteSkillIdb(delId);
        } else {
          const target = skills.find((s) => s.id === id);
          const newParentId = target?.parentId ?? null;
          const next = skills
            .filter((s) => s.id !== id)
            .map((s) => (s.parentId === id ? { ...s, parentId: newParentId } : s));
          const versioned = syncGraph(next);
          saveAllSkills(versioned);
          deleteSkillIdb(id);
        }
        setSelectedNodeId(null);
      }
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
          const versioned = syncGraph(next);
          saveAllSkills(versioned);
          batchSaveSkills(versioned).catch(() => {});
        }
      }
    },
    [skills, setEdges, syncGraph],
  );

  const [confirmReset, setConfirmReset] = useState(false);

  const handleReset = useCallback(async () => {
    try {
      await resetAllSkills();
      await clearAllSkills();
      setSkills([]);
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      setConfirmReset(false);
    } catch {
      // If server reset fails, still clear client
      await clearAllSkills();
      setSkills([]);
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      setConfirmReset(false);
    }
  }, [setNodes, setEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const refreshGraph = useCallback(async () => {
    try {
      const serverSkills = await fetchAllSkills();
      if (serverSkills.length > 0) {
        syncGraph(serverSkills.map((s) => ({ ...s, files: s.files ?? [] })));
      }
    } catch {
      // ignore
    }
  }, [syncGraph]);

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

      {skills.length > 0 && (
        <div className="reset-btn-group" style={selectedSkill ? { right: 396 } : undefined}>
          {confirmReset ? (
            <>
              <span className="reset-confirm-label">Reset all?</span>
              <button className="reset-confirm-yes" onClick={handleReset}>Yes</button>
              <button className="reset-confirm-no" onClick={() => setConfirmReset(false)}>No</button>
            </>
          ) : (
            <button
              className="reset-btn"
              onClick={() => setConfirmReset(true)}
              title="Reset all skills and nodes"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {selectedSkill && (
        <DetailPanel
          skill={selectedSkill}
          onClose={() => setSelectedNodeId(null)}
          onUpdateSkill={updateSkill}
          onDeleteSkill={deleteSkillNode}
          onRefreshGraph={refreshGraph}
        />
      )}
    </div>
  );
}
