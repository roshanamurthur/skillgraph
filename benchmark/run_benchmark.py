#!/usr/bin/env python3
"""
run_benchmark.py  –  Benchmark runner for the student grades skill.

Usage:
    python3 run_benchmark.py --version v0

For each test input CSV it:
  1. Invokes the skill via the Claude CLI
  2. Parses the generated Excel output
  3. Compares every computed value against the ground truth JSON
  4. Writes a scored JSON report per test case to /logs/eval_results/
  5. Prints a human-readable summary table
  6. Diffs against the previous version's results if available
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT          = Path(__file__).parent.parent
BENCHMARK_DIR = Path(__file__).parent
INPUTS_DIR    = BENCHMARK_DIR / "test_inputs"
GT_DIR        = BENCHMARK_DIR / "ground_truth"
SKILL_DIR     = ROOT / "skill"
LOGS_BASE     = ROOT / "logs" / "eval_results"
LOGS_BASE.mkdir(parents=True, exist_ok=True)

TOLERANCE = 0.001

# Grade boundaries for boundary-case detection
GRADE_BOUNDARIES = [96.5, 92.5, 89.5, 86.5, 82.5, 79.5, 76.5, 72.5, 69.5, 66.5, 62.5, 59.5]
BOUNDARY_PROXIMITY = 0.5  # avg within this distance of a boundary = boundary case


# ── Scoring helpers ───────────────────────────────────────────────────────────

def fraction(passed: int, total: int) -> str:
    return f"{passed}/{total}"

def score(passed: int, total: int) -> float:
    return round(passed / total, 2) if total > 0 else 0.0

def make_category(passed_checks: list, failed_checks: list) -> dict:
    p = len(passed_checks)
    t = p + len(failed_checks)
    return {
        "fraction": fraction(p, t),
        "score":    score(p, t),
        "passed":   p,
        "total":    t,
        "passed_checks": passed_checks,
        "failed_checks": failed_checks,
    }


# ── Failure description generator ────────────────────────────────────────────

def describe_failure(check_name: str, actual, expected) -> str:
    parts = check_name.split(".")
    # student.<sid>.<field>
    if parts[0] == "student" and len(parts) == 3:
        sid, field = parts[1], parts[2]
        if field == "letter_grade":
            return (f"{sid} letter_grade: got '{actual}', expected '{expected}' "
                    f"— likely using simple boundaries instead of plus/minus scale")
        if field == "std_dev":
            return (f"{sid} std_dev: got {actual}, expected {expected} "
                    f"— likely using population std dev (ddof=0) instead of sample (ddof=1)")
        if field == "slope":
            return (f"{sid} slope: got {actual}, expected {expected} "
                    f"— check linear regression formula or test score ordering")
        if field == "rank":
            return (f"{sid} rank: got {actual}, expected {expected} "
                    f"— check tie-handling logic (tied students should share the highest rank)")
        if field == "above_class_average":
            return (f"{sid} above_class_average: got {actual}, expected {expected} "
                    f"— check class average computation or comparison operator (> not >=)")
        if field == "average":
            return (f"{sid} average: got {actual}, expected {expected} "
                    f"— check mean calculation or rounding")
        if field in ("highest_score", "lowest_score"):
            return (f"{sid} {field}: got {actual}, expected {expected} "
                    f"— check min/max over the correct score columns")
        return f"{sid} {field}: got {actual}, expected {expected}"

    # test.<tname>.<field>
    if parts[0] == "test" and len(parts) == 3:
        tname, field = parts[1], parts[2]
        if field == "std_dev":
            return (f"{tname} std_dev: got {actual}, expected {expected} "
                    f"— likely using population std dev instead of sample (ddof=1)")
        if field == "class_average":
            return (f"{tname} class_average: got {actual}, expected {expected} "
                    f"— check column mean calculation")
        if field in ("highest_score", "lowest_score"):
            return (f"{tname} {field}: got {actual}, expected {expected} "
                    f"— check min/max over the correct column")
        return f"{tname} {field}: got {actual}, expected {expected}"

    # overall.*
    if parts[0] == "overall":
        field = ".".join(parts[1:])
        if field == "class_average":
            return (f"overall class_average: got {actual}, expected {expected} "
                    f"— should be mean of student averages, not mean of all raw scores")
        if field == "class_median":
            return (f"overall class_median: got {actual}, expected {expected} "
                    f"— should be median of student averages")
        if field == "most_improved_student":
            return (f"most_improved_student: got '{actual}', expected '{expected}' "
                    f"— should be student with highest slope (linear regression)")
        if field == "most_consistent_student":
            return (f"most_consistent_student: got '{actual}', expected '{expected}' "
                    f"— should be student with lowest sample std dev")
        if field.startswith("grade_dist."):
            grade = field.split(".")[-1]
            return (f"grade distribution '{grade}': got {actual}, expected {expected} "
                    f"— check grade boundary for '{grade}' or letter assignment logic")
        return f"overall {field}: got {actual}, expected {expected}"

    return f"{check_name}: got {actual}, expected {expected}"


# ── Boundary-case detector ────────────────────────────────────────────────────

def is_boundary_check(check_name: str, gt: dict) -> bool:
    """
    Returns True if this check specifically exercises an edge case:
      - rank checks where ties exist in the ground truth
      - letter_grade checks where the student's average is near a grade boundary
      - any check on a student in 04_extreme.csv (scores of 0 or 100)
      - std_dev checks where scores are all identical (zero variance)
    """
    parts = check_name.split(".")
    if parts[0] != "student" or len(parts) != 3:
        return False

    sid, field = parts[1], parts[2]
    gt_s = gt["per_student"].get(sid, {})

    # Tied rank
    if field == "rank":
        expected_rank = gt_s.get("rank")
        tied = sum(1 for s in gt["per_student"].values() if s["rank"] == expected_rank) > 1
        if tied:
            return True

    # Letter grade near a boundary
    if field == "letter_grade":
        avg = gt_s.get("average", 0)
        if any(abs(avg - b) <= BOUNDARY_PROXIMITY for b in GRADE_BOUNDARIES):
            return True

    # Extreme scores (any score is 0 or 100)
    scores = gt_s.get("scores", [])
    if scores and (0.0 in scores or 100.0 in scores):
        return True

    # Zero variance (all scores identical)
    if field == "std_dev" and scores and len(set(scores)) == 1:
        return True

    return False


# ── Comparison engine ─────────────────────────────────────────────────────────

def compare(parsed: dict, gt: dict) -> dict:
    """
    Returns a categories dict with scored results.
    """
    student_pass, student_fail = [], []
    test_pass,    test_fail    = [], []
    overall_pass, overall_fail = [], []
    boundary_pass, boundary_fail = [], []

    def record(passed_list, failed_list, name, actual, expected,
               category: str, context: str = ""):
        ok = _close_enough(actual, expected)
        entry = {"check": name, "actual": actual, "expected": expected}
        if ok:
            passed_list.append(entry)
        else:
            failed_entry = dict(entry)
            failed_entry["category"] = category
            if context:
                failed_entry["context"] = context
            failed_entry["description"] = describe_failure(name, actual, expected)
            failed_list.append(failed_entry)
        return ok

    # ── Per-student ────────────────────────────────────────────────────────────
    for sid, gt_s in gt["per_student"].items():
        p_s = parsed["per_student"].get(sid, {})
        for field in ["average", "slope", "std_dev", "highest_score", "lowest_score",
                      "rank", "letter_grade", "above_class_average"]:
            name = f"student.{sid}.{field}"
            actual   = p_s.get(field)
            expected = gt_s[field]
            if is_boundary_check(name, gt):
                record(boundary_pass, boundary_fail, name, actual, expected,
                       "boundary_cases", sid)
            else:
                record(student_pass, student_fail, name, actual, expected,
                       "student_calculations", sid)

    # ── Per-test ───────────────────────────────────────────────────────────────
    for tname, gt_t in gt["per_test"].items():
        p_t = parsed["per_test"].get(tname, {})
        for field in ["class_average", "std_dev", "highest_score", "lowest_score"]:
            name = f"test.{tname}.{field}"
            record(test_pass, test_fail, name,
                   p_t.get(field), gt_t[field],
                   "test_column_stats", tname)

    # ── Overall ────────────────────────────────────────────────────────────────
    gt_ov = gt["overall"]
    p_ov  = parsed["overall"]
    for field in ["class_average", "class_median",
                  "most_improved_student", "most_consistent_student"]:
        record(overall_pass, overall_fail, f"overall.{field}",
               p_ov.get(field), gt_ov[field], "overall_stats")

    for grade, gt_count in gt_ov["grade_distribution"].items():
        actual_count = p_ov.get("grade_distribution", {}).get(grade)
        record(overall_pass, overall_fail, f"overall.grade_dist.{grade}",
               actual_count, gt_count, "overall_stats")

    return {
        "student_calculations": make_category(student_pass,  student_fail),
        "test_column_stats":    make_category(test_pass,     test_fail),
        "overall_stats":        make_category(overall_pass,  overall_fail),
        "boundary_cases":       make_category(boundary_pass, boundary_fail),
    }


def _close_enough(actual, expected, tol=TOLERANCE) -> bool:
    try:
        return abs(float(actual) - float(expected)) <= tol
    except (TypeError, ValueError):
        return str(actual).strip() == str(expected).strip()


# ── Excel parser ──────────────────────────────────────────────────────────────

def parse_excel_output(xlsx_path: Path) -> dict:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    def norm(s: str) -> str:
        return re.sub(r"[\s_]+", "_", str(s).strip().lower())

    def sheet_to_records(sheet_name: str) -> list:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [norm(h) for h in rows[0]]
        return [dict(zip(headers, row)) for row in rows[1:] if any(c is not None for c in row)]

    per_student = {}
    for rec in sheet_to_records("Student Stats"):
        sid = str(rec.get("student_id", rec.get("student", "")))
        per_student[sid] = {
            "average":             rec.get("average"),
            "letter_grade":        rec.get("letter_grade", rec.get("grade")),
            "slope":               rec.get("slope"),
            "std_dev":             rec.get("std_dev", rec.get("standard_deviation")),
            "highest_score":       rec.get("highest_score", rec.get("max")),
            "lowest_score":        rec.get("lowest_score", rec.get("min")),
            "rank":                rec.get("rank"),
            "above_class_average": rec.get("above_class_average", rec.get("above_avg")),
        }

    per_test = {}
    for rec in sheet_to_records("Test Stats"):
        tname = str(rec.get("test", rec.get("test_name", "")))
        per_test[tname] = {
            "class_average": rec.get("class_average", rec.get("average")),
            "std_dev":       rec.get("std_dev", rec.get("standard_deviation")),
            "highest_score": rec.get("highest_score", rec.get("max")),
            "lowest_score":  rec.get("lowest_score", rec.get("min")),
        }

    overall_raw = {}
    ws_ov = wb["Overall"] if "Overall" in wb.sheetnames else None
    if ws_ov:
        for row in ws_ov.iter_rows(values_only=True):
            if row and row[0] is not None:
                overall_raw[norm(str(row[0]))] = row[1] if len(row) > 1 else None

    grade_dist = {}
    for g in ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","F"]:
        key = norm(f"grade_{g}")
        if key in overall_raw:
            grade_dist[g] = overall_raw[key]

    overall = {
        "class_average":          overall_raw.get("class_average"),
        "class_median":           overall_raw.get("class_median"),
        "grade_distribution":     grade_dist,
        "most_improved_student":  overall_raw.get("most_improved_student"),
        "most_consistent_student": overall_raw.get("most_consistent_student"),
    }

    return {"per_student": per_student, "per_test": per_test, "overall": overall}


# ── Skill runner ──────────────────────────────────────────────────────────────

def run_skill(skill_path: Path, csv_path: Path, output_dir: Path) -> tuple:
    output_dir.mkdir(parents=True, exist_ok=True)
    xlsx_path = output_dir / (csv_path.stem + "_output.xlsx")

    prompt = f"""You are executing the student grades skill defined in {skill_path}.

Input CSV:        {csv_path}
Output Excel:     {xlsx_path}

Execute the skill exactly as specified. As you work, produce a detailed execution
trace by explicitly logging each of the following decision points:

SLOPE FORMULA
- State the exact formula you are using for slope (OLS, numpy polyfit, or other)
- Confirm the x-axis values you are using (e.g. [1,2,3,4,5])
- Show the computed slope for at least the first student as a sanity check

LETTER GRADE BOUNDARIES
- List the exact grade boundary thresholds you are applying (including plus/minus)
- For each student, state which boundary their average falls into and the grade assigned
- Flag any student whose average is within 0.5 points of a boundary

RANK TIE-BREAKING
- Describe the tie-breaking strategy you are using (dense rank, competition rank, etc.)
- Identify any tied students and explicitly state the rank assigned to each
- If no ties exist in this dataset, state that explicitly

STANDARD DEVIATION
- Confirm whether you are using sample std dev (ddof=1) or population (ddof=0)
- Show the computed std dev for at least the first student

INTERPRETATION CHOICES
- Note any point where the skill specification was ambiguous and state your choice
- Note any edge case in the data (e.g. all-zero scores, perfect scores, missing values)
  and how you handled it

After completing the Excel output, print a one-line summary confirming the output
file was written and the sheet names used.
"""

    trace = ""
    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--allowedTools", "Bash,Write,Read"],
            capture_output=True, text=True, timeout=120
        )
        trace = result.stdout + result.stderr
        if not xlsx_path.exists():
            return None, trace
    except Exception as e:
        return None, str(e)

    return xlsx_path, trace


# ── Version diff ──────────────────────────────────────────────────────────────

def load_previous_report(test_stem: str, current_version: str) -> dict:
    """Find the most recent report for the same test input from a different version."""
    candidates = []
    for version_dir in LOGS_BASE.iterdir():
        if version_dir.is_dir() and version_dir.name != current_version:
            candidates.extend(version_dir.glob(f"{test_stem}_*.json"))
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for path in candidates:
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            continue
    return None


def diff_reports(current: dict, previous: dict) -> dict:
    """
    Compare check results between two reports.
    Returns {improved: [...], regressed: [...], unchanged_pass: int, unchanged_fail: int}
    """
    def flatten_checks(report: dict) -> dict:
        """check_name -> passed for all checks in all categories."""
        result = {}
        for cat in report.get("categories", {}).values():
            for c in cat.get("passed_checks", []):
                result[c["check"]] = True
            for c in cat.get("failed_checks", []):
                result[c["check"]] = False
        return result

    cur_checks  = flatten_checks(current)
    prev_checks = flatten_checks(previous)

    improved, regressed = [], []
    unchanged_pass = unchanged_fail = 0

    for name, cur_passed in cur_checks.items():
        prev_passed = prev_checks.get(name)
        if prev_passed is None:
            continue  # new check, skip
        if not prev_passed and cur_passed:
            improved.append(name)
        elif prev_passed and not cur_passed:
            regressed.append(name)
        elif cur_passed:
            unchanged_pass += 1
        else:
            unchanged_fail += 1

    return {
        "previous_version": previous.get("skill_version", "unknown"),
        "improved":         improved,
        "regressed":        regressed,
        "unchanged_pass":   unchanged_pass,
        "unchanged_fail":   unchanged_fail,
    }


# ── Console summary ───────────────────────────────────────────────────────────

CATEGORY_LABELS = {
    "student_calculations": "Student Calculations",
    "test_column_stats":    "Test Column Stats   ",
    "overall_stats":        "Overall Stats       ",
    "boundary_cases":       "Boundary Cases      ",
}

def print_summary_table(test_name: str, categories: dict):
    print(f"\n  {test_name}")
    total_p = total_t = 0
    for key, label in CATEGORY_LABELS.items():
        cat = categories.get(key, {})
        p, t = cat.get("passed", 0), cat.get("total", 0)
        total_p += p
        total_t += t
        s   = cat.get("score", 0.0)
        sym = "✅" if p == t else "❌"
        print(f"    {label}  {fraction(p,t):>6}  ({s:.2f})  {sym}")
    print(f"    {'─' * 45}")
    overall_s = score(total_p, total_t)
    sym = "✅" if total_p == total_t else "❌"
    print(f"    {'Overall':22}  {fraction(total_p, total_t):>6}  ({overall_s:.2f})  {sym}")


def print_diff(diff: dict):
    prev = diff["previous_version"]
    improved  = diff["improved"]
    regressed = diff["regressed"]
    print(f"\n  Diff vs {prev}:")
    if improved:
        print(f"    ✅ Improved  ({len(improved)}): " + ", ".join(improved[:5])
              + (" ..." if len(improved) > 5 else ""))
    if regressed:
        print(f"    ❌ Regressed ({len(regressed)}): " + ", ".join(regressed[:5])
              + (" ..." if len(regressed) > 5 else ""))
    print(f"    Unchanged: {diff['unchanged_pass']} passing, {diff['unchanged_fail']} failing")


# ── Main ──────────────────────────────────────────────────────────────────────

def run_benchmark(version: str):
    skill_path = SKILL_DIR / f"skill_{version}.md"
    if not skill_path.exists():
        print(f"Skill file not found: {skill_path}")
        sys.exit(1)

    output_dir = ROOT / "outputs" / version
    logs_dir   = LOGS_BASE / version
    logs_dir.mkdir(parents=True, exist_ok=True)
    csv_files  = sorted(INPUTS_DIR.glob("*.csv"))
    timestamp  = datetime.now().strftime("%Y%m%d_%H%M%S")

    all_summaries = []

    for csv_path in csv_files:
        gt_path = GT_DIR / (csv_path.stem + ".json")
        if not gt_path.exists():
            print(f"No ground truth for {csv_path.name}, skipping.")
            continue

        with open(gt_path) as f:
            gt = json.load(f)

        print(f"\nRunning: {csv_path.name} ...")
        xlsx_path, trace = run_skill(skill_path, csv_path, output_dir)

        if xlsx_path is None:
            categories = {k: make_category([], []) for k in CATEGORY_LABELS}
            report = {
                "test_input":      csv_path.name,
                "skill_version":   version,
                "timestamp":       timestamp,
                "execution_trace": trace,
                "error":           "Skill did not produce Excel output.",
                "overall":         {"fraction": "0/0", "score": 0.0, "passed": 0, "total": 0},
                "categories":      categories,
            }
        else:
            try:
                parsed     = parse_excel_output(xlsx_path)
                categories = compare(parsed, gt)
                total_p = sum(c["passed"] for c in categories.values())
                total_t = sum(c["total"]  for c in categories.values())
                report = {
                    "test_input":      csv_path.name,
                    "skill_version":   version,
                    "timestamp":       timestamp,
                    "execution_trace": trace,
                    "overall": {
                        "fraction": fraction(total_p, total_t),
                        "score":    score(total_p, total_t),
                        "passed":   total_p,
                        "total":    total_t,
                    },
                    "categories": categories,
                }
            except Exception as e:
                categories = {k: make_category([], []) for k in CATEGORY_LABELS}
                report = {
                    "test_input":      csv_path.name,
                    "skill_version":   version,
                    "timestamp":       timestamp,
                    "execution_trace": trace,
                    "error":           f"Parse/compare error: {e}",
                    "overall":         {"fraction": "0/0", "score": 0.0, "passed": 0, "total": 0},
                    "categories":      categories,
                }

        # Version diff
        prev_report = load_previous_report(csv_path.stem, version)
        if prev_report:
            report["version_diff"] = diff_reports(report, prev_report)

        out_file = logs_dir / f"{csv_path.stem}_{version}_{timestamp}.json"
        with open(out_file, "w") as f:
            json.dump(report, f, indent=2, default=str)

        print_summary_table(csv_path.name, report["categories"])
        if prev_report and "version_diff" in report:
            print_diff(report["version_diff"])

        all_summaries.append(report)

    # ── Aggregate summary across all test files ──────────────────────────────
    if all_summaries:
        print(f"\n{'═' * 52}")
        print(f"  BENCHMARK COMPLETE  —  skill {version}")
        print(f"{'═' * 52}")
        agg_p = sum(r["overall"]["passed"] for r in all_summaries)
        agg_t = sum(r["overall"]["total"]  for r in all_summaries)
        print(f"  Total: {fraction(agg_p, agg_t)}  ({score(agg_p, agg_t):.2f})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True, help="Skill version, e.g. v0")
    args = parser.parse_args()
    run_benchmark(args.version)
