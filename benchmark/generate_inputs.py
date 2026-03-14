#!/usr/bin/env python3
"""
Generate all 5 benchmark CSV files into benchmark/test_inputs/.

Columns: student_id, quiz_1, quiz_2, quiz_3, quiz_4,
         test_1, test_2, test_3, test_4, test_5, test_6

Run once; outputs are stored in test_inputs/ and used by generate_ground_truth.py.
"""

import numpy as np
import pandas as pd
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "test_inputs"
OUTPUT_DIR.mkdir(exist_ok=True)

QUIZ_COLS = ["quiz_1", "quiz_2", "quiz_3", "quiz_4"]
TEST_COLS = ["test_1", "test_2", "test_3", "test_4", "test_5", "test_6"]
ALL_COLS  = QUIZ_COLS + TEST_COLS

QUIZ_WEIGHT = 0.05           # per quiz
TEST_WEIGHT = 80 / 6 / 100  # per test = 4/30


def make_student_ids(n):
    return [f"S{i:03d}" for i in range(1, n + 1)]


def weighted_avg(scores):
    """scores is list of 10 values: 4 quizzes then 6 tests."""
    q = scores[:4]
    t = scores[4:]
    return sum(x * QUIZ_WEIGHT for x in q) + sum(x * TEST_WEIGHT for x in t)


# ── 01_clean.csv ──────────────────────────────────────────────────────────────

def generate_01_clean():
    rng = np.random.default_rng(2026)
    n = 25
    sids = make_student_ids(n)
    rows = []
    for sid in sids:
        quizzes = rng.normal(78, 9, 4)
        tests   = rng.normal(75, 11, 6)
        scores  = np.concatenate([quizzes, tests])
        scores  = np.clip(scores, 55, 100).round().astype(int).tolist()
        rows.append([sid] + scores)
    df = pd.DataFrame(rows, columns=["student_id"] + ALL_COLS)
    return df


# ── 02_trending.csv ───────────────────────────────────────────────────────────

def generate_02_trending():
    rng = np.random.default_rng(2026)
    n = 25
    sids = make_student_ids(n)
    rows = []

    # S001-S006 (indices 0-5): strong upward
    for i in range(6):
        start = 55 + i * 2
        end   = 88 + i * 2
        base  = np.linspace(start, end, 10)
        noise = rng.normal(0, 3, 10)
        scores = np.clip(np.round(base + noise), 40, 100).astype(int).tolist()
        rows.append([sids[i]] + scores)

    # S007-S012 (indices 6-11): strong downward
    for i in range(6):
        start = 88 + i * 2
        end   = 55 + i * 2
        base  = np.linspace(start, end, 10)
        noise = rng.normal(0, 3, 10)
        scores = np.clip(np.round(base + noise), 40, 100).astype(int).tolist()
        rows.append([sids[6 + i]] + scores)

    # S013-S017 (indices 12-16): moderate upward
    for i in range(5):
        start = 65 + i * 2
        end   = 80 + i * 2
        base  = np.linspace(start, end, 10)
        noise = rng.normal(0, 3, 10)
        scores = np.clip(np.round(base + noise), 40, 100).astype(int).tolist()
        rows.append([sids[12 + i]] + scores)

    # S018-S022 (indices 17-21): moderate downward
    for i in range(5):
        start = 80 + i * 2
        end   = 65 + i * 2
        base  = np.linspace(start, end, 10)
        noise = rng.normal(0, 3, 10)
        scores = np.clip(np.round(base + noise), 40, 100).astype(int).tolist()
        rows.append([sids[17 + i]] + scores)

    # S023-S025 (indices 22-24): flat around 70+i*3
    for i in range(3):
        center = 70 + i * 3
        noise  = rng.normal(0, 4, 10)
        scores = np.clip(np.round(center + noise), 40, 100).astype(int).tolist()
        rows.append([sids[22 + i]] + scores)

    df = pd.DataFrame(rows, columns=["student_id"] + ALL_COLS)
    return df


# ── 03_ties.csv ───────────────────────────────────────────────────────────────

def generate_03_ties():
    rng = np.random.default_rng(303)
    n = 25
    sids = make_student_ids(n)
    rows = []

    # S001-S003: identical scores [82]*10
    for sid in sids[0:3]:
        rows.append([sid] + [82] * 10)

    # S004-S006: identical scores [75]*10
    for sid in sids[3:6]:
        rows.append([sid] + [75] * 10)

    # S007-S008: identical scores [90]*10
    for sid in sids[6:8]:
        rows.append([sid] + [90] * 10)

    # S009-S011: identical scores [68]*10
    for sid in sids[8:11]:
        rows.append([sid] + [68] * 10)

    # S012-S025: varied scores (indices 11-24)
    tied_values = {82, 75, 90, 68}
    for sid in sids[11:25]:
        while True:
            quizzes = rng.normal(75, 10, 4)
            tests   = rng.normal(73, 10, 6)
            scores  = np.concatenate([quizzes, tests])
            scores  = np.clip(scores, 50, 100).round().astype(int).tolist()
            # Make sure none accidentally create a tied weighted average
            wa = round(weighted_avg(scores), 6)
            tied_was = {round(weighted_avg([v] * 10), 6) for v in tied_values}
            if wa not in tied_was:
                break
        rows.append([sid] + scores)

    df = pd.DataFrame(rows, columns=["student_id"] + ALL_COLS)
    return df


# ── 04_extreme.csv ────────────────────────────────────────────────────────────

def generate_04_extreme():
    rows = [
        # S001: all 100
        ["S001"] + [100] * 10,
        # S002: all 0
        ["S002"] + [0] * 10,
        # S003: quizzes=0, tests=100 → weighted = 0*0.20 + 100*0.80 = 80.0
        ["S003"] + [0, 0, 0, 0, 100, 100, 100, 100, 100, 100],
        # S004: quizzes=100, tests=0 → weighted = 100*0.20 + 0*0.80 = 20.0
        ["S004"] + [100, 100, 100, 100, 0, 0, 0, 0, 0, 0],
        # S005-S017: all same score
        ["S005"] + [98] * 10,
        ["S006"] + [94] * 10,
        ["S007"] + [91] * 10,
        ["S008"] + [88] * 10,
        ["S009"] + [85] * 10,
        ["S010"] + [81] * 10,
        ["S011"] + [78] * 10,
        ["S012"] + [75] * 10,
        ["S013"] + [71] * 10,
        ["S014"] + [68] * 10,
        ["S015"] + [65] * 10,
        ["S016"] + [61] * 10,
        ["S017"] + [55] * 10,
        # S018: quizzes=[100,100,0,0], tests=[100,100,100,0,0,0]
        # weighted = 200*0.05 + 300*(4/30) = 10 + 40 = 50
        ["S018"] + [100, 100, 0, 0, 100, 100, 100, 0, 0, 0],
        # S019: varied
        ["S019"] + [60, 70, 80, 90, 60, 70, 80, 90, 95, 100],
        # S020: varied
        ["S020"] + [50, 60, 70, 80, 70, 75, 80, 85, 90, 95],
        # S021: descending quizzes, descending tests
        ["S021"] + [95, 90, 85, 80, 70, 65, 60, 55, 50, 45],
        # S022: quizzes=80, tests=96 → weighted = 16 + 76.8 = 92.8
        ["S022"] + [80, 80, 80, 80, 96, 96, 96, 96, 96, 96],
        # S023: quizzes=80, tests=83 → weighted = 16 + 66.4 = 82.4
        ["S023"] + [80, 80, 80, 80, 83, 83, 83, 83, 83, 83],
        # S024: quizzes=80, tests=77 → weighted = 16 + 61.6 = 77.6
        ["S024"] + [80, 80, 80, 80, 77, 77, 77, 77, 77, 77],
        # S025: quizzes=80, tests=65 → weighted = 16 + 52 = 68.0
        ["S025"] + [80, 80, 80, 80, 65, 65, 65, 65, 65, 65],
    ]
    df = pd.DataFrame(rows, columns=["student_id"] + ALL_COLS)
    return df


# ── 05_large.csv ──────────────────────────────────────────────────────────────

def generate_05_large():
    rng = np.random.default_rng(2026)
    n = 40
    sids = make_student_ids(n)
    rows = []
    for sid in sids:
        quizzes = rng.normal(75, 12, 4)
        tests   = rng.normal(74, 13, 6)
        scores  = np.concatenate([quizzes, tests])
        scores  = np.clip(scores, 45, 100).round().astype(int).tolist()
        rows.append([sid] + scores)
    df = pd.DataFrame(rows, columns=["student_id"] + ALL_COLS)
    return df


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    generators = [
        ("01_clean.csv",    generate_01_clean),
        ("02_trending.csv", generate_02_trending),
        ("03_ties.csv",     generate_03_ties),
        ("04_extreme.csv",  generate_04_extreme),
        ("05_large.csv",    generate_05_large),
    ]

    print(f"\nGenerating CSVs into {OUTPUT_DIR}\n")
    print(f"{'File':<20}  {'N':>4}  {'Min WA':>8}  {'Max WA':>8}  {'Mean WA':>8}")
    print("-" * 55)

    for fname, gen_fn in generators:
        df = gen_fn()
        out_path = OUTPUT_DIR / fname
        df.to_csv(out_path, index=False)

        # Compute weighted averages for summary
        was = []
        for _, row in df.iterrows():
            scores = [float(row[c]) for c in ALL_COLS]
            was.append(weighted_avg(scores))

        print(f"{fname:<20}  {len(df):>4}  {min(was):>8.2f}  {max(was):>8.2f}  {sum(was)/len(was):>8.2f}")

    print(f"\nDone. {len(generators)} files written.\n")


if __name__ == "__main__":
    main()
