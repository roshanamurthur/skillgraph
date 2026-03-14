#!/usr/bin/env python3
"""
Generate ground truth JSON files for each test input CSV.
Run once; outputs are stored in ground_truth/ and used by run_benchmark.py.
"""

import json
import math
import os
import numpy as np
import pandas as pd
from pathlib import Path

INPUTS_DIR = Path(__file__).parent / "test_inputs"
OUTPUT_DIR = Path(__file__).parent / "ground_truth"
OUTPUT_DIR.mkdir(exist_ok=True)

GRADE_THRESHOLDS = [
    (96.5, "A+"),
    (92.5, "A"),
    (89.5, "A-"),
    (86.5, "B+"),
    (82.5, "B"),
    (79.5, "B-"),
    (76.5, "C+"),
    (72.5, "C"),
    (69.5, "C-"),
    (66.5, "D+"),
    (62.5, "D"),
    (59.5, "D-"),
    (0,    "F"),
]

ALL_GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"]

def letter_grade(avg: float) -> str:
    for threshold, grade in GRADE_THRESHOLDS:
        if avg >= threshold:
            return grade
    return "F"

def slope(scores: list[float]) -> float:
    """Least-squares slope of scores over test indices 1..5."""
    x = np.arange(1, len(scores) + 1, dtype=float)
    y = np.array(scores, dtype=float)
    n = len(x)
    return float((n * np.dot(x, y) - x.sum() * y.sum()) / (n * np.dot(x, x) - x.sum() ** 2))

def rank_with_ties(averages: dict[str, float]) -> dict[str, int]:
    """Rank students by average descending; ties share the highest rank."""
    sorted_avgs = sorted(set(averages.values()), reverse=True)
    rank_map = {avg: i + 1 for i, avg in enumerate(sorted_avgs)}
    return {sid: rank_map[avg] for sid, avg in averages.items()}

def compute_ground_truth(csv_path: Path) -> dict:
    df = pd.read_csv(csv_path)
    test_cols = [c for c in df.columns if c != "student_id"]

    # ── Per-student stats ─────────────────────────────────────────────────────
    student_avgs = {}
    per_student = {}
    for _, row in df.iterrows():
        sid = str(row["student_id"])
        scores = [float(row[c]) for c in test_cols]
        avg = float(np.mean(scores))
        student_avgs[sid] = avg
        per_student[sid] = {
            "scores": scores,
            "average": round(avg, 6),
            "letter_grade": letter_grade(avg),
            "slope": round(slope(scores), 6),
            "std_dev": round(float(np.std(scores, ddof=1)), 6),
            "highest_score": float(max(scores)),
            "lowest_score": float(min(scores)),
        }

    class_avg = float(np.mean(list(student_avgs.values())))
    ranks = rank_with_ties(student_avgs)
    for sid in per_student:
        per_student[sid]["rank"] = ranks[sid]
        per_student[sid]["above_class_average"] = student_avgs[sid] > class_avg

    # ── Per-test stats ────────────────────────────────────────────────────────
    per_test = {}
    for col in test_cols:
        vals = df[col].astype(float).tolist()
        per_test[col] = {
            "class_average": round(float(np.mean(vals)), 6),
            "std_dev": round(float(np.std(vals, ddof=1)), 6),
            "highest_score": float(max(vals)),
            "lowest_score": float(min(vals)),
        }

    # ── Overall stats ─────────────────────────────────────────────────────────
    all_scores = df[test_cols].values.astype(float).flatten().tolist()
    all_avgs = list(student_avgs.values())

    grade_dist = {g: 0 for g in ALL_GRADES}
    for avg in all_avgs:
        grade_dist[letter_grade(avg)] += 1

    most_improved_sid = max(per_student, key=lambda s: per_student[s]["slope"])
    most_consistent_sid = min(per_student, key=lambda s: per_student[s]["std_dev"])

    overall = {
        "class_average": round(float(np.mean(all_avgs)), 6),
        "class_median": round(float(np.median(all_avgs)), 6),
        "grade_distribution": grade_dist,
        "most_improved_student": most_improved_sid,
        "most_consistent_student": most_consistent_sid,
    }

    return {
        "source_file": csv_path.name,
        "per_student": per_student,
        "per_test": per_test,
        "overall": overall,
    }

def main():
    csv_files = sorted(INPUTS_DIR.glob("*.csv"))
    if not csv_files:
        print("No CSV files found in test_inputs/")
        return

    for csv_path in csv_files:
        gt = compute_ground_truth(csv_path)
        out_path = OUTPUT_DIR / (csv_path.stem + ".json")
        with open(out_path, "w") as f:
            json.dump(gt, f, indent=2)
        print(f"Generated: {out_path.name}")

if __name__ == "__main__":
    main()
