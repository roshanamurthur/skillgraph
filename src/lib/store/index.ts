import { openDB, type IDBPDatabase } from "idb";
import type { Skill } from "@/lib/types";

const DB_NAME = "skillgraph";
const DB_VERSION = 1;
const STORE_NAME = "skills";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function loadSkills(): Promise<Skill[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function saveSkill(skill: Skill): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, skill);
}

export async function saveAllSkills(skills: Skill[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  for (const skill of skills) {
    await tx.store.put(skill);
  }
  await tx.done;
}

export async function deleteSkill(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

export async function clearAllSkills(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}
