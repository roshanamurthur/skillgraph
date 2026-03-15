#!/usr/bin/env python3
"""
run_benchmark.py  --  Benchmark runner for the student grades skill.

Usage:
    python3 run_benchmark.py --version v0

For each test input CSV it:
  1. Sends the skill + CSV data to OpenAI API, gets structured JSON back
  2. Compares every computed value against the ground truth JSON
  3. Writes a scored JSON report per test
  4. Prints a human-readable summary table
  5. Diffs against the previous version's results if available
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

# -- Paths ---------------------------------------------------------------------
ROOT          = Path(__file__).parent.parent
BENCHMARK_DIR = Path(__file__).parent
INPUTS_DIR    = BENCHMARK_DIR / "test_inputs"
GT_DIR        = BENCHMARK_DIR / "ground_truth"
SKILL_DIR     = ROOT / "skill"
LOGS_BASE     = ROOT / "logs" / "eval_results"
LOGS_BASE.mkdir(parents=True, exist_ok=True)

TOLERANCE = 0.001

GRADE_BOUNDARIES = [96.5, 92.5, 89.5, 86.5, 82.5, 79.5, 76.5, 72.5, 69.5, 66.5, 62.5, 59.5]
BOUNDARY_PROXIMITY = 0.5


# -- Helpers -------------------------------------------------------------------

def _close_enough(actual, expected, tol=TOLERANCE):
    try:
        return abs(float(actual) - float(expected)) <= tol
    except (TypeError, ValueError):
        return str(actual).strip() == str(expected).strip()

def _delta(actual, expected):
    try:
        return round(abs(float(actual) - float(expected)), 6)
    except (TypeError, ValueError):
        return None

def fraction(passed, total):
    return f"{passed}/{total}"

def score(passed, total):
    return round(passed / total, 2) if total > 0 else 0.0

def norm(s):
    return re.sub(r"[\s_]+", "_", str(s).strip().lower())

def make_category(passed_checks, failed_checks):
    p = len(passed_checks)
    t = p + len(failed_checks)
    return {
        "fraction":      fraction(p, t),
        "score":         score(p, t),
        "passed":        p,
        "total":         t,
        "passed_checks": passed_checks,   # {check, actual} only
        "failed_checks": failed_checks,   # full location + delta
    }


# -- Failure descriptions ------------------------------------------------------

def describe_failure(check_name, actual, expected, delta=None):
    delta_str = f" — delta {delta}" if delta is not None else ""
    parts = check_name.split(".")

    if parts[0] == "student" and len(parts) == 3:
        sid, field = parts[1], parts[2]
        if field == "weighted_average":
            hint = "suggests simple average used instead of weighted" if delta and delta > 0.1 else "check weight formula"
            return f"{sid} weighted_average: got {actual}, expected {expected}{delta_str} — {hint}"
        if field == "simple_average":
            return f"{sid} simple_average: got {actual}, expected {expected}{delta_str} — check mean calculation"
        if field == "letter_grade":
            return f"{sid} letter_grade: got '{actual}', expected '{expected}' — likely wrong grade scale or based on simple avg instead of weighted avg"
        if field == "std_dev":
            return f"{sid} std_dev: got {actual}, expected {expected}{delta_str} — likely using population (ddof=0) instead of sample (ddof=1)"
        if field == "slope":
            return f"{sid} slope: got {actual}, expected {expected}{delta_str} — check OLS formula or score ordering (quiz_1..quiz_4, test_1..test_6)"
        if field == "rank":
            return f"{sid} rank: got {actual}, expected {expected} — check tie-handling (tied students share highest rank)"
        if field == "percentile":
            return f"{sid} percentile: got {actual}, expected {expected}{delta_str} — formula: (count strictly below / (n-1)) * 100"
        if field == "z_score":
            return f"{sid} z_score: got {actual}, expected {expected}{delta_str} — z = (student_wa - class_wa_mean) / class_wa_sample_std"
        if field == "above_class_average":
            return f"{sid} above_class_average: got {actual}, expected {expected} — check class average or use strict > not >="
        if field in ("highest_score", "lowest_score"):
            return f"{sid} {field}: got {actual}, expected {expected} — check min/max over all score columns"
        return f"{sid} {field}: got {actual}, expected {expected}{delta_str}"

    if parts[0] == "assessment" and len(parts) == 3:
        aname, field = parts[1], parts[2]
        if field == "std_dev":
            return f"{aname} std_dev: got {actual}, expected {expected}{delta_str} — use sample std dev (ddof=1)"
        if field == "class_average":
            return f"{aname} class_average: got {actual}, expected {expected}{delta_str} — check column mean"
        if field in ("highest_score", "lowest_score"):
            return f"{aname} {field}: got {actual}, expected {expected} — check min/max for this column"
        return f"{aname} {field}: got {actual}, expected {expected}{delta_str}"

    if parts[0] == "assessment_z" and len(parts) == 3:
        aname, sid = parts[1], parts[2]
        return f"{aname} z_score for {sid}: got {actual}, expected {expected}{delta_str} — z = (score - col_mean) / col_std"

    if parts[0] == "overall":
        field = ".".join(parts[1:])
        if field == "class_weighted_average":
            return f"class_weighted_average: got {actual}, expected {expected}{delta_str} — should be mean of student weighted_averages"
        if field == "class_median":
            return f"class_median: got {actual}, expected {expected}{delta_str} — should be median of student weighted_averages"
        if field == "most_improved_student":
            return f"most_improved_student: got '{actual}', expected '{expected}' — student with highest OLS slope"
        if field == "most_consistent_student":
            return f"most_consistent_student: got '{actual}', expected '{expected}' — student with lowest sample std dev"
        if field.startswith("grade_dist."):
            g = field.split(".")[-1]
            return f"grade_distribution['{g}']: got {actual}, expected {expected} — check grade boundary for '{g}'"
        return f"overall {field}: got {actual}, expected {expected}{delta_str}"

    return f"{check_name}: got {actual}, expected {expected}{delta_str}"


# -- Boundary-case detector ----------------------------------------------------

def is_boundary_check(check_name, gt):
    parts = check_name.split(".")
    if parts[0] != "student" or len(parts) != 3:
        return False
    sid, field = parts[1], parts[2]
    gt_s = gt["per_student"].get(sid, {})

    if field == "rank":
        expected_rank = gt_s.get("rank")
        if sum(1 for s in gt["per_student"].values() if s["rank"] == expected_rank) > 1:
            return True

    if field == "percentile":
        expected_pct = gt_s.get("percentile")
        if sum(1 for s in gt["per_student"].values() if s["percentile"] == expected_pct) > 1:
            return True

    if field in ("letter_grade", "weighted_average", "percentile", "z_score"):
        wa = gt_s.get("weighted_average", 0)
        if any(abs(wa - b) <= BOUNDARY_PROXIMITY for b in GRADE_BOUNDARIES):
            return True

    scores = gt_s.get("scores", [])
    if scores and (0.0 in scores or 100.0 in scores):
        return True

    if field == "std_dev" and scores and len(set(scores)) == 1:
        return True

    return False


# -- Location resolution -------------------------------------------------------

def resolve_location(check_name, location_map):
    """
    Map a check name to its exact Excel location.
    Returns a dict with: cell, sheet, row, column_letter, column_name, entity
    or None if the location cannot be resolved.
    """
    if location_map is None:
        return None
    parts = check_name.split(".")

    def lookup_row(lm, key):
        rows = lm.get("rows", {})
        return rows.get(key) or rows.get(norm(key))

    def lookup_col(lm, field):
        cols = lm.get("columns", {})
        return cols.get(field) or cols.get(norm(field))

    if parts[0] == "student" and len(parts) == 3:
        sid, field = parts[1], parts[2]
        sheet = "Student Stats"
        lm = location_map.get(sheet, {})
        row = lookup_row(lm, sid)
        col = lookup_col(lm, field)
        if row and col:
            return {"cell": f"'{sheet}'!{col}{row}", "sheet": sheet,
                    "row": row, "column_letter": col, "column_name": field, "entity": sid}

    if parts[0] == "assessment" and len(parts) == 3:
        aname, field = parts[1], parts[2]
        sheet = "Assessment Stats"
        lm = location_map.get(sheet, {})
        row = lookup_row(lm, aname)
        col = lookup_col(lm, field)
        if row and col:
            return {"cell": f"'{sheet}'!{col}{row}", "sheet": sheet,
                    "row": row, "column_letter": col, "column_name": field, "entity": aname}

    if parts[0] == "assessment_z" and len(parts) == 3:
        aname, sid = parts[1], parts[2]
        sheet = "Z-Scores"
        lm = location_map.get(sheet, {})
        row = lookup_row(lm, sid)
        col = lookup_col(lm, aname)
        if row and col:
            return {"cell": f"'{sheet}'!{col}{row}", "sheet": sheet,
                    "row": row, "column_letter": col,
                    "column_name": aname, "entity": f"{sid}/{aname}"}

    if parts[0] == "overall":
        field = ".".join(parts[1:])
        sheet = "Overall"
        lm = location_map.get(sheet, {})
        # grade_dist.A+ → look for row keyed as "grade_a+"
        if field.startswith("grade_dist."):
            grade = field.split(".")[-1]
            row_key = norm(f"grade_{grade}")
        else:
            row_key = field
        row = lookup_row(lm, row_key)
        col = lm.get("columns", {}).get("value", "B")
        if row:
            return {"cell": f"'{sheet}'!{col}{row}", "sheet": sheet,
                    "row": row, "column_letter": col, "column_name": field, "entity": "Overall"}

    return None


# -- Comparison engine ---------------------------------------------------------

def compare(parsed, gt, location_map=None):
    student_pass, student_fail = [], []
    assess_pass,  assess_fail  = [], []
    overall_pass, overall_fail = [], []
    advanced_pass, advanced_fail = [], []
    boundary_pass, boundary_fail = [], []

    def record(p_list, f_list, name, actual, expected, category, context=""):
        ok = _close_enough(actual, expected)
        if ok:
            p_list.append({"check": name, "actual": actual})
        else:
            d = _delta(actual, expected)
            entry = {
                "check":       name,
                "passed":      False,
                "actual":      actual,
                "expected":    expected,
                "delta":       d,
                "description": describe_failure(name, actual, expected, d),
            }
            loc = resolve_location(name, location_map)
            if loc:
                entry.update(loc)
            elif context:
                entry["entity"] = context
            f_list.append(entry)
        return ok

    base_fields = [
        "simple_average", "weighted_average", "letter_grade", "slope",
        "std_dev", "highest_score", "lowest_score", "rank", "above_class_average",
    ]
    advanced_student_fields = ["percentile", "z_score"]

    for sid, gt_s in gt["per_student"].items():
        p_s = parsed["per_student"].get(sid, {})
        for field in base_fields:
            name = f"student.{sid}.{field}"
            if is_boundary_check(name, gt):
                record(boundary_pass, boundary_fail, name, p_s.get(field), gt_s[field], "boundary_cases", sid)
            else:
                record(student_pass, student_fail, name, p_s.get(field), gt_s[field], "student_calculations", sid)
        for field in advanced_student_fields:
            name = f"student.{sid}.{field}"
            if is_boundary_check(name, gt):
                record(boundary_pass, boundary_fail, name, p_s.get(field), gt_s[field], "boundary_cases", sid)
            else:
                record(advanced_pass, advanced_fail, name, p_s.get(field), gt_s[field], "advanced_metrics", sid)

    for aname, gt_a in gt["per_assessment"].items():
        p_a = parsed["per_assessment"].get(aname, {})
        for field in ["class_average", "std_dev", "highest_score", "lowest_score"]:
            record(assess_pass, assess_fail, f"assessment.{aname}.{field}",
                   p_a.get(field), gt_a[field], "assessment_stats", aname)

    for aname, gt_a in gt["per_assessment"].items():
        gt_zs = gt_a.get("per_student_z_scores", {})
        p_zs  = parsed["per_assessment"].get(aname, {}).get("per_student_z_scores", {})
        for sid, expected_z in gt_zs.items():
            record(advanced_pass, advanced_fail, f"assessment_z.{aname}.{sid}",
                   p_zs.get(sid), expected_z, "advanced_metrics", f"{aname}/{sid}")

    gt_ov = gt["overall"]
    p_ov  = parsed["overall"]
    for field in ["class_weighted_average", "class_median",
                  "most_improved_student", "most_consistent_student"]:
        record(overall_pass, overall_fail, f"overall.{field}",
               p_ov.get(field), gt_ov[field], "overall_stats")
    for grade, gt_count in gt_ov["grade_distribution"].items():
        record(overall_pass, overall_fail, f"overall.grade_dist.{grade}",
               p_ov.get("grade_distribution", {}).get(grade), gt_count, "overall_stats")

    return {
        "student_calculations": make_category(student_pass,  student_fail),
        "assessment_stats":     make_category(assess_pass,   assess_fail),
        "overall_stats":        make_category(overall_pass,  overall_fail),
        "advanced_metrics":     make_category(advanced_pass, advanced_fail),
        "boundary_cases":       make_category(boundary_pass, boundary_fail),
    }


# -- Post-processing: failures by location -------------------------------------

def build_failures_by_location(categories):
    result = defaultdict(lambda: defaultdict(list))
    for cat in categories.values():
        for fc in cat["failed_checks"]:
            sheet   = fc.get("sheet", "Unknown")
            row     = fc.get("row")
            entity  = fc.get("entity", "unknown")
            col_name = fc.get("column_name", fc["check"])
            actual  = fc.get("actual")
            expected = fc.get("expected")
            d       = fc.get("delta")
            delta_str = f" (delta {d})" if d is not None else ""
            row_key = f"row_{row}_{entity}" if row else f"row_unknown_{entity}"
            result[sheet][row_key].append(
                f"{col_name}: expected {expected} got {actual}{delta_str}"
            )
    # Convert defaultdicts to plain dicts for JSON serialisation
    return {sheet: dict(rows) for sheet, rows in result.items()}


# -- OpenAI API caller ---------------------------------------------------------

OUTPUT_SCHEMA = """{
  "per_student": {
    "<student_id>": {
      "simple_average": <number>,
      "weighted_average": <number>,
      "letter_grade": "<string>",
      "slope": <number>,
      "std_dev": <number>,
      "highest_score": <number>,
      "lowest_score": <number>,
      "rank": <integer>,
      "percentile": <number>,
      "z_score": <number>,
      "above_class_average": <boolean>
    }
  },
  "per_assessment": {
    "<assessment_name>": {
      "class_average": <number>,
      "std_dev": <number>,
      "highest_score": <number>,
      "lowest_score": <number>,
      "per_student_z_scores": { "<student_id>": <number> }
    }
  },
  "overall": {
    "class_weighted_average": <number>,
    "class_median": <number>,
    "grade_distribution": { "A+": <int>, "A": <int>, ..., "F": <int> },
    "most_improved_student": "<student_id>",
    "most_consistent_student": "<student_id>"
  }
}"""


def call_openai(skill_instructions, csv_content, model=None):
    """
    Call OpenAI Responses API with skill instructions + CSV data.
    Returns (parsed_json, reasoning_trace, token_usage) or raises on failure.
    """
    api_key  = os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model    = model or os.environ.get("OPENAI_MODEL", "gpt-4o")

    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set in environment")

    user_prompt = f"""INPUT CSV:
{csv_content}

TASK: Follow the skill instructions above to analyze this student grade data.
Compute ALL metrics described in the skill for EVERY student and EVERY assessment.
Work through the calculations systematically in your reasoning — process each student one at a time.

You MUST return a complete JSON object with this structure:
{OUTPUT_SCHEMA}

Rules:
- Use the exact student IDs from the CSV (S001, S002, etc.)
- Use the exact column names as assessment names: quiz_1, quiz_2, quiz_3, quiz_4, test_1, test_2, test_3, test_4, test_5, test_6
- Compute every value — do NOT use placeholders or dummy numbers
- Return ONLY the JSON object, no other text"""

    body = {
        "model": model,
        "instructions": skill_instructions,
        "input": [{"role": "user", "content": user_prompt}],
        "max_output_tokens": 16384,
    }

    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    # Retry once without reasoning if model doesn't support it
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        if e.code == 400 and ("reasoning" in err_body or "not supported" in err_body):
            print(f"  Model {model} does not support reasoning — retrying without it.")
            del body["reasoning"]
            req = urllib.request.Request(
                f"{base_url.rstrip('/')}/responses",
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read())
        else:
            raise RuntimeError(f"OpenAI API error {e.code}: {err_body[:500]}")

    # Extract content and reasoning from response
    output_items = data.get("output", [])
    content = ""
    reasoning_parts = []

    for item in output_items:
        if item.get("type") == "message":
            for part in item.get("content", []):
                if part.get("type") == "output_text":
                    content += part.get("text", "")
        elif item.get("type") == "reasoning":
            for s in item.get("summary", []):
                if s.get("type") == "summary_text" and s.get("text"):
                    reasoning_parts.append(s["text"])

    reasoning_trace = "\n\n".join(reasoning_parts) if reasoning_parts else None

    usage = data.get("usage", {})
    token_usage = {
        "input":     usage.get("input_tokens", 0),
        "output":    usage.get("output_tokens", 0),
        "reasoning": usage.get("output_tokens_details", {}).get("reasoning_tokens", 0),
    }

    # Parse JSON from content — handle code fences, prose wrapping, or empty content
    text = content.strip()
    if not text:
        raise RuntimeError("LLM returned empty content (all tokens spent on reasoning?)")

    # Strip markdown code fences
    text = re.sub(r"^```\w*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()

    # Try direct parse first
    parsed = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Extract the largest JSON object from mixed prose + JSON
        # Find the first { and match to the last }
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace >= 0 and last_brace > first_brace:
            json_text = text[first_brace:last_brace + 1]
            try:
                parsed = json.loads(json_text)
            except json.JSONDecodeError:
                pass

    if parsed is None:
        raise RuntimeError(f"LLM returned invalid JSON.\nRaw output:\n{text[:1000]}")

    return parsed, reasoning_trace, token_usage


def run_skill(skill_path, csv_path):
    """Run the skill against a CSV via OpenAI API. Returns (parsed_data, reasoning_trace, token_usage)."""
    skill_content = skill_path.read_text()
    csv_content   = csv_path.read_text()
    return call_openai(skill_content, csv_content)


# -- REMOVED: parse_excel_output (no longer needed — LLM returns JSON directly)
# -- REMOVED: generate_summary_excel (no longer needed — no Excel output)


# -- Version diff --------------------------------------------------------------

def load_previous_report(test_stem, current_version):
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


def diff_reports(current, previous):
    def flatten_checks(report):
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
            continue
        if not prev_passed and cur_passed:   improved.append(name)
        elif prev_passed and not cur_passed: regressed.append(name)
        elif cur_passed:  unchanged_pass += 1
        else:             unchanged_fail += 1
    return {
        "previous_version": previous.get("skill_version", "unknown"),
        "improved":         improved,
        "regressed":        regressed,
        "unchanged_pass":   unchanged_pass,
        "unchanged_fail":   unchanged_fail,
    }


# -- Console summary -----------------------------------------------------------

CATEGORY_LABELS = {
    "student_calculations": "Student Calculations",
    "assessment_stats":     "Assessment Stats    ",
    "overall_stats":        "Overall Stats       ",
    "advanced_metrics":     "Advanced Metrics    ",
    "boundary_cases":       "Boundary Cases      ",
}

def _top_column_failures(failed_checks, top_n=3):
    """Return top N (sheet, col, col_name, entities, min_row, max_row) by error count."""
    col_data = defaultdict(lambda: {"entities": [], "rows": []})
    for fc in failed_checks:
        sheet    = fc.get("sheet", "?")
        col      = fc.get("column_letter", "?")
        col_name = fc.get("column_name", fc.get("check", "?"))
        entity   = fc.get("entity", "?")
        row      = fc.get("row")
        key = (sheet, col, col_name)
        col_data[key]["entities"].append(entity)
        if row:
            col_data[key]["rows"].append(row)
    sorted_cols = sorted(col_data.items(), key=lambda x: -len(x[1]["entities"]))[:top_n]
    result = []
    for (sheet, col, col_name), data in sorted_cols:
        rows = sorted(data["rows"])
        rng  = f"{col}{rows[0]}:{col}{rows[-1]}" if len(rows) > 1 else (f"{col}{rows[0]}" if rows else col)
        result.append((sheet, col, col_name, data["entities"], rng))
    return result

def print_summary_table(test_name, categories):
    print(f"\n  {test_name}")
    total_p = total_t = 0
    for key, label in CATEGORY_LABELS.items():
        cat = categories.get(key, {})
        p, t  = cat.get("passed", 0), cat.get("total", 0)
        total_p += p
        total_t += t
        s   = cat.get("score", 0.0)
        sym = "OK" if p == t else "!!"
        print(f"    {label}  {fraction(p,t):>10}  ({s:.2f})  {sym}")
        if p < t:
            for sheet, col, col_name, entities, rng in _top_column_failures(cat["failed_checks"]):
                n = len(entities)
                print(f"      -> {sheet}!{rng}  {col_name}: wrong in {n} row(s)")
    print(f"    {'--' * 26}")
    overall_s = score(total_p, total_t)
    sym = "OK" if total_p == total_t else "!!"
    print(f"    {'Overall':22}  {fraction(total_p, total_t):>10}  ({overall_s:.2f})  {sym}")


def print_diff(diff):
    prev = diff["previous_version"]
    print(f"\n  Diff vs {prev}:")
    if diff["improved"]:
        print(f"    [+] Improved  ({len(diff['improved'])}): "
              + ", ".join(diff["improved"][:5]) + (" ..." if len(diff["improved"]) > 5 else ""))
    if diff["regressed"]:
        print(f"    [-] Regressed ({len(diff['regressed'])}): "
              + ", ".join(diff["regressed"][:5]) + (" ..." if len(diff["regressed"]) > 5 else ""))
    print(f"    Unchanged: {diff['unchanged_pass']} passing, {diff['unchanged_fail']} failing")


# -- Main ----------------------------------------------------------------------

def _run_single_test(csv_path, gt, skill_path, version, timestamp, logs_dir):
    """Run a single test case via OpenAI API. Returns the report dict."""
    import traceback as tb
    try:
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Starting: {csv_path.name}")
        parsed, reasoning_trace, token_usage = run_skill(skill_path, csv_path)

        categories = compare(parsed, gt)
        total_p = sum(c["passed"] for c in categories.values())
        total_t = sum(c["total"]  for c in categories.values())
        report = {
            "test_input":       csv_path.name,
            "skill_version":    version,
            "timestamp":        timestamp,
            "reasoning_trace":  reasoning_trace,
            "token_usage":      token_usage,
            "overall": {
                "fraction": fraction(total_p, total_t),
                "score":    score(total_p, total_t),
                "passed":   total_p,
                "total":    total_t,
            },
            "categories":             categories,
            "failures_by_location":   build_failures_by_location(categories),
        }

        prev_report = load_previous_report(csv_path.stem, version)
        if prev_report:
            report["version_diff"] = diff_reports(report, prev_report)

        out_file = logs_dir / f"{csv_path.stem}_{version}_{timestamp}.json"
        with open(out_file, "w") as f:
            json.dump(report, f, indent=2, default=str)

        print(f"[{datetime.now().strftime('%H:%M:%S')}] Finished: {csv_path.name} — "
              f"{fraction(total_p, total_t)} ({token_usage['input']}+{token_usage['output']} tokens)")
        return report

    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] FAILED: {csv_path.name}: {e}")
        categories = {k: make_category([], []) for k in CATEGORY_LABELS}
        report = {
            "test_input":      csv_path.name,
            "skill_version":   version,
            "timestamp":       timestamp,
            "error":           f"Error: {e}\n{tb.format_exc()}",
            "overall":         {"fraction": "0/0", "score": 0.0, "passed": 0, "total": 0},
            "categories":      categories,
        }
        out_file = logs_dir / f"{csv_path.stem}_{version}_{timestamp}.json"
        with open(out_file, "w") as f:
            json.dump(report, f, indent=2, default=str)
        return report


def run_benchmark(version):
    skill_path = SKILL_DIR / f"skill_{version}.md"
    if not skill_path.exists():
        print(f"Skill file not found: {skill_path}")
        sys.exit(1)

    logs_dir = LOGS_BASE / version
    logs_dir.mkdir(parents=True, exist_ok=True)
    csv_files = sorted(INPUTS_DIR.glob("*.csv"))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    all_summaries = []

    # Build list of (csv_path, gt) pairs
    test_cases = []
    for csv_path in csv_files:
        gt_path = GT_DIR / (csv_path.stem + ".json")
        if not gt_path.exists():
            print(f"No ground truth for {csv_path.name}, skipping.")
            continue
        with open(gt_path) as f:
            gt = json.load(f)
        test_cases.append((csv_path, gt))

    # Run all tests in parallel
    print(f"\nRunning {len(test_cases)} tests in parallel via OpenAI API...")
    with ThreadPoolExecutor(max_workers=len(test_cases)) as pool:
        futures = {}
        for csv_path, gt in test_cases:
            fut = pool.submit(
                _run_single_test,
                csv_path, gt, skill_path, version, timestamp, logs_dir,
            )
            futures[fut] = csv_path

        for fut in as_completed(futures):
            csv_path = futures[fut]
            try:
                report = fut.result()
                all_summaries.append(report)
            except Exception as e:
                print(f"Error collecting result for {csv_path.name}: {e}")

    # Sort by test name for consistent output
    all_summaries.sort(key=lambda r: r["test_input"])

    # Print summaries after all tests complete
    for report in all_summaries:
        print_summary_table(report["test_input"], report["categories"])
        if "version_diff" in report:
            print_diff(report["version_diff"])

    if all_summaries:
        print(f"\n{'=' * 52}")
        print(f"  BENCHMARK COMPLETE  --  skill {version}")
        print(f"{'=' * 52}")
        agg_p = sum(r["overall"]["passed"] for r in all_summaries)
        agg_t = sum(r["overall"]["total"]  for r in all_summaries)
        print(f"  Total: {fraction(agg_p, agg_t)}  ({score(agg_p, agg_t):.2f})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True, help="Skill version, e.g. v0")
    args = parser.parse_args()
    run_benchmark(args.version)
