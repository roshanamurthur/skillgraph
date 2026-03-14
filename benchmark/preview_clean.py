#!/usr/bin/env python3
"""
Preview ground truth for the new 01_clean.csv structure.
25 students, 4 quizzes + 6 tests, weighted average, percentile, z-scores.
Run this before committing to the full expansion.
"""

import numpy as np
import json

QUIZ_WEIGHT = 0.05          # per quiz  (4 x 0.05 = 0.20)
TEST_WEIGHT = 80 / 6 / 100  # per test  (6 x 13.333% = 0.80)

GRADE_THRESHOLDS = [
    (96.5, "A+"), (92.5, "A"),  (89.5, "A-"),
    (86.5, "B+"), (82.5, "B"),  (79.5, "B-"),
    (76.5, "C+"), (72.5, "C"),  (69.5, "C-"),
    (66.5, "D+"), (62.5, "D"),  (59.5, "D-"),
    (0,    "F"),
]

def letter_grade(avg):
    for threshold, grade in GRADE_THRESHOLDS:
        if avg >= threshold:
            return grade
    return "F"

def slope(scores):
    x = np.arange(1, len(scores) + 1, dtype=float)
    y = np.array(scores, dtype=float)
    n = len(x)
    return float((n * np.dot(x, y) - x.sum() * y.sum()) / (n * np.dot(x, x) - x.sum()**2))

# ── Generate 01_clean data (seeded for reproducibility) ────────────────────
np.random.seed(2026)
n_students = 25

raw_quizzes = np.clip(np.random.normal(78, 9, (n_students, 4)), 55, 100).round(0).astype(int)
raw_tests   = np.clip(np.random.normal(75, 11, (n_students, 6)), 50, 100).round(0).astype(int)

student_ids = [f"S{i:03d}" for i in range(1, n_students + 1)]
quiz_cols   = ["quiz_1", "quiz_2", "quiz_3", "quiz_4"]
test_cols   = ["test_1", "test_2", "test_3", "test_4", "test_5", "test_6"]
all_cols    = quiz_cols + test_cols

# ── Weighted averages ───────────────────────────────────────────────────────
weighted_avgs = {}
simple_avgs   = {}
per_student   = {}

for i, sid in enumerate(student_ids):
    quizzes = raw_quizzes[i].tolist()
    tests   = raw_tests[i].tolist()
    scores  = quizzes + tests
    wavg = sum(q * QUIZ_WEIGHT for q in quizzes) + sum(t * TEST_WEIGHT for t in tests)
    savg = float(np.mean(scores))
    weighted_avgs[sid] = wavg
    simple_avgs[sid]   = savg
    per_student[sid] = {
        "quizzes": quizzes,
        "tests":   tests,
        "scores":  scores,
        "simple_average":   round(savg, 6),
        "weighted_average": round(wavg, 6),
        "letter_grade":     letter_grade(wavg),
        "slope":            round(slope(scores), 6),
        "std_dev":          round(float(np.std(scores, ddof=1)), 6),
        "highest_score":    float(max(scores)),
        "lowest_score":     float(min(scores)),
    }

# ── Class stats for z-scores ────────────────────────────────────────────────
class_wavg_mean = float(np.mean(list(weighted_avgs.values())))
class_wavg_std  = float(np.std(list(weighted_avgs.values()), ddof=1))

# ── Rank and percentile ─────────────────────────────────────────────────────
sorted_avgs = sorted(set(weighted_avgs.values()), reverse=True)
rank_map    = {avg: i + 1 for i, avg in enumerate(sorted_avgs)}

for sid in student_ids:
    wavg = weighted_avgs[sid]
    n_below = sum(1 for v in weighted_avgs.values() if v < wavg)
    pct = round(n_below / (n_students - 1) * 100, 1)
    zscore = round((wavg - class_wavg_mean) / class_wavg_std, 2)
    per_student[sid]["rank"]               = rank_map[wavg]
    per_student[sid]["percentile"]         = pct
    per_student[sid]["z_score"]            = zscore
    per_student[sid]["above_class_average"] = wavg > class_wavg_mean

# ── Per-assessment z-scores ─────────────────────────────────────────────────
assess_scores = {col: [] for col in all_cols}
for i, sid in enumerate(student_ids):
    for j, col in enumerate(quiz_cols):
        assess_scores[col].append(float(raw_quizzes[i][j]))
    for j, col in enumerate(test_cols):
        assess_scores[col].append(float(raw_tests[i][j]))

per_assessment_stats = {}
for col in all_cols:
    vals = assess_scores[col]
    mean = float(np.mean(vals))
    std  = float(np.std(vals, ddof=1))
    per_assessment_stats[col] = {"mean": round(mean, 6), "std_dev": round(std, 6)}

for i, sid in enumerate(student_ids):
    z_per_assess = {}
    for j, col in enumerate(quiz_cols):
        s = float(raw_quizzes[i][j])
        m = per_assessment_stats[col]["mean"]
        sd = per_assessment_stats[col]["std_dev"]
        z_per_assess[col] = round((s - m) / sd, 2) if sd > 0 else 0.0
    for j, col in enumerate(test_cols):
        s = float(raw_tests[i][j])
        m = per_assessment_stats[col]["mean"]
        sd = per_assessment_stats[col]["std_dev"]
        z_per_assess[col] = round((s - m) / sd, 2) if sd > 0 else 0.0
    per_student[sid]["z_scores_per_assessment"] = z_per_assess

# ── Grade distribution ───────────────────────────────────────────────────────
ALL_GRADES = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","F"]
grade_dist = {g: 0 for g in ALL_GRADES}
for sid in student_ids:
    grade_dist[per_student[sid]["letter_grade"]] += 1

# ── Most improved / most consistent ─────────────────────────────────────────
most_improved_sid   = max(student_ids, key=lambda s: (per_student[s]["slope"],   per_student[s]["weighted_average"]))
most_consistent_sid = min(student_ids, key=lambda s: (per_student[s]["std_dev"], -per_student[s]["weighted_average"]))

overall = {
    "class_weighted_average": round(class_wavg_mean, 6),
    "class_median":           round(float(np.median(list(weighted_avgs.values()))), 6),
    "grade_distribution":     grade_dist,
    "most_improved_student":  most_improved_sid,
    "most_consistent_student": most_consistent_sid,
}

# ── Print preview ─────────────────────────────────────────────────────────────
print("=" * 110)
print("PREVIEW: 01_clean.csv ground truth  (25 students, 4 quizzes + 6 tests)")
print(f"Quiz weight: {QUIZ_WEIGHT} each  |  Test weight: {TEST_WEIGHT:.6f} each  |  Total: {4*QUIZ_WEIGHT + 6*TEST_WEIGHT:.4f}")
print(f"Class weighted avg mean: {class_wavg_mean:.4f}  |  Class weighted avg std (sample): {class_wavg_std:.4f}")
print("=" * 110)

hdr = f"{'SID':<6} {'Quizzes':>26} {'Tests':>42}  {'SAvg':>6} {'WAvg':>7} {'Grd':>4} {'Slope':>7} {'StdDev':>7} {'Hi':>4} {'Lo':>4} {'Rk':>3} {'Pct':>5} {'Z':>6} {'Abv'}"
print(hdr)
print("-" * 110)
for sid in student_ids:
    s = per_student[sid]
    q_str = " ".join(f"{v:3d}" for v in s["quizzes"])
    t_str = " ".join(f"{v:3d}" for v in s["tests"])
    print(f"{sid:<6} [{q_str}] [{t_str}]  "
          f"{s['simple_average']:6.2f} {s['weighted_average']:7.3f} {s['letter_grade']:>4} "
          f"{s['slope']:7.3f} {s['std_dev']:7.3f} {s['highest_score']:4.0f} {s['lowest_score']:4.0f} "
          f"{s['rank']:3d} {s['percentile']:5.1f} {s['z_score']:6.2f} {'Y' if s['above_class_average'] else 'N'}")

print()
print("OVERALL")
print(f"  Class weighted avg:  {overall['class_weighted_average']:.4f}")
print(f"  Class median:        {overall['class_median']:.4f}")
print(f"  Most improved:       {overall['most_improved_student']}  (slope {per_student[overall['most_improved_student']]['slope']:.3f})")
print(f"  Most consistent:     {overall['most_consistent_student']}  (std_dev {per_student[overall['most_consistent_student']]['std_dev']:.3f})")
print(f"  Grade distribution:  { {k:v for k,v in grade_dist.items() if v > 0} }")

print()
print("SAMPLE Z-SCORES PER ASSESSMENT (S001)")
for col, z in per_student["S001"]["z_scores_per_assessment"].items():
    s_score = raw_quizzes[0][quiz_cols.index(col)] if col in quiz_cols else raw_tests[0][test_cols.index(col)]
    stats = per_assessment_stats[col]
    print(f"  {col:>8}: score={s_score:3.0f}  mean={stats['mean']:6.2f}  std={stats['std_dev']:6.2f}  z={z:6.2f}")
