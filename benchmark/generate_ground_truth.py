#!/usr/bin/env python3
"""
Generate ground truth JSON files for each test input CSV.
Run once; outputs are stored in ground_truth/ and used by run_benchmark.py.
"""

import json
import os
import numpy as np
import pandas as pd
from pathlib import Path

INPUTS_DIR = Path(__file__).parent / "test_inputs"
OUTPUT_DIR = Path(__file__).parent / "ground_truth"
OUTPUT_DIR.mkdir(exist_ok=True)

QUIZ_WEIGHT = 0.05           # per quiz
TEST_WEIGHT = 80 / 6 / 100  # per test = 4/30

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


def letter_grade(avg):
    for threshold, grade in GRADE_THRESHOLDS:
        if avg >= threshold:
            return grade
    return "F"


def ols_slope(scores):
    """Least-squares slope of scores over indices 1..N."""
    x = np.arange(1, len(scores) + 1, dtype=float)
    y = np.array(scores, dtype=float)
    n = len(x)
    return float((n * np.dot(x, y) - x.sum() * y.sum()) / (n * np.dot(x, x) - x.sum() ** 2))


def rank_with_ties(averages):
    """Rank students by average descending; ties share the highest rank."""
    sorted_avgs = sorted(set(averages.values()), reverse=True)
    rank_map = {avg: i + 1 for i, avg in enumerate(sorted_avgs)}
    return {sid: rank_map[avg] for sid, avg in averages.items()}


def compute_ground_truth(csv_path):
    df = pd.read_csv(csv_path)
    quiz_cols = [c for c in df.columns if c.startswith("quiz_")]
    test_cols = [c for c in df.columns if c.startswith("test_")]
    all_score_cols = quiz_cols + test_cols
    n_students = len(df)

    # ── Per-student stats (pass 1: compute scores and weighted averages) ───────
    student_weighted_avgs = {}
    per_student = {}

    for _, row in df.iterrows():
        sid = str(row["student_id"])
        scores = [float(row[c]) for c in all_score_cols]
        q_scores = [float(row[c]) for c in quiz_cols]
        t_scores = [float(row[c]) for c in test_cols]

        simple_avg = float(np.mean(scores))
        weighted_avg = round(
            sum(q * QUIZ_WEIGHT for q in q_scores) + sum(t * TEST_WEIGHT for t in t_scores),
            6
        )

        student_weighted_avgs[sid] = weighted_avg
        per_student[sid] = {
            "scores":         scores,
            "simple_average": round(simple_avg, 6),
            "weighted_average": weighted_avg,
            "letter_grade":   letter_grade(weighted_avg),
            "slope":          round(ols_slope(scores), 6),
            "std_dev":        round(float(np.std(scores, ddof=1)), 6),
            "highest_score":  float(max(scores)),
            "lowest_score":   float(min(scores)),
        }

    # ── Class-level stats needed for percentile and z_score ───────────────────
    all_was = list(student_weighted_avgs.values())
    class_wa_mean = float(np.mean(all_was))
    class_wa_std  = float(np.std(all_was, ddof=1))  # sample std

    # ── Rank ──────────────────────────────────────────────────────────────────
    ranks = rank_with_ties(student_weighted_avgs)

    # ── Percentile: (count strictly below / (n-1)) * 100 ─────────────────────
    # Students with same weighted_avg get same percentile.
    def compute_percentile(wa):
        count_below = sum(1 for w in all_was if w < wa)
        if n_students <= 1:
            return 0.0
        return round(count_below / (n_students - 1) * 100, 1)

    # ── Z-score: (wa - class_mean) / class_std (sample ddof=1) ───────────────
    def compute_z_score(wa):
        if class_wa_std == 0:
            return 0.0
        return round((wa - class_wa_mean) / class_wa_std, 2)

    # ── Populate remaining per-student fields ─────────────────────────────────
    for sid in per_student:
        wa = student_weighted_avgs[sid]
        per_student[sid]["rank"]               = ranks[sid]
        per_student[sid]["percentile"]         = compute_percentile(wa)
        per_student[sid]["z_score"]            = compute_z_score(wa)
        per_student[sid]["above_class_average"] = bool(wa > class_wa_mean)

    # ── Per-assessment stats ───────────────────────────────────────────────────
    per_assessment = {}
    for col in all_score_cols:
        vals = df[col].astype(float).values
        col_mean = float(np.mean(vals))
        col_std  = float(np.std(vals, ddof=1))

        per_student_z = {}
        for _, row in df.iterrows():
            sid = str(row["student_id"])
            v = float(row[col])
            if col_std == 0:
                z = 0.0
            else:
                z = round((v - col_mean) / col_std, 2)
            per_student_z[sid] = z

        per_assessment[col] = {
            "class_average":      round(col_mean, 6),
            "std_dev":            round(col_std, 6),
            "highest_score":      float(np.max(vals)),
            "lowest_score":       float(np.min(vals)),
            "per_student_z_scores": per_student_z,
        }

    # ── Overall stats ──────────────────────────────────────────────────────────
    grade_dist = {g: 0 for g in ALL_GRADES}
    for wa in all_was:
        grade_dist[letter_grade(wa)] += 1

    # most_improved: highest slope, tiebreak by higher weighted_average
    most_improved_sid = max(
        per_student,
        key=lambda s: (per_student[s]["slope"], student_weighted_avgs[s])
    )
    # most_consistent: lowest std_dev, tiebreak by higher weighted_average
    most_consistent_sid = min(
        per_student,
        key=lambda s: (per_student[s]["std_dev"], -student_weighted_avgs[s])
    )

    overall = {
        "class_weighted_average": round(class_wa_mean, 6),
        "class_median":           round(float(np.median(all_was)), 6),
        "grade_distribution":     grade_dist,
        "most_improved_student":  most_improved_sid,
        "most_consistent_student": most_consistent_sid,
    }

    return {
        "source_file":    csv_path.name,
        "per_student":    per_student,
        "per_assessment": per_assessment,
        "overall":        overall,
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
