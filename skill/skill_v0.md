# Skill: Student Grade Report Generator (v0)

## Purpose
Given a CSV of student test scores, produce a formatted Excel workbook (.xlsx)
containing computed statistics for students, individual tests, and the overall class.

## Input
A CSV file where:
- Column 1: `student_id` — unique string identifier per student
- Columns 2–6: `test1` through `test5` — numeric scores (0–100)

## Output
An Excel workbook with three sheets: **Student Stats**, **Test Stats**, **Overall**.

---

## Sheet 1: Student Stats
One row per student. Columns (in order):

| Column | Description |
|--------|-------------|
| student_id | From input CSV |
| test1…test5 | Raw scores |
| average | Mean of the five test scores |
| letter_grade | Grade based on average (see scale below) |
| slope | Linear regression slope across test1→test5 (x = 1,2,3,4,5) |
| std_dev | **Sample** standard deviation of the five scores (ddof=1) |
| highest_score | Max of the five scores |
| lowest_score | Min of the five scores |
| rank | Rank within class by average, descending. Ties share the highest rank. |
| above_class_average | TRUE if student average > class average, FALSE otherwise |

### Grade Scale (by average)
| Range | Grade |
|-------|-------|
| 96.5 – 100 | A+ |
| 92.5 – 96.49 | A |
| 89.5 – 92.49 | A- |
| 86.5 – 89.49 | B+ |
| 82.5 – 86.49 | B |
| 79.5 – 82.49 | B- |
| 76.5 – 79.49 | C+ |
| 72.5 – 76.49 | C |
| 69.5 – 72.49 | C- |
| 66.5 – 69.49 | D+ |
| 62.5 – 66.49 | D |
| 59.5 – 62.49 | D- |
| Below 59.5 | F |

### Slope Formula
Use ordinary least squares over x = [1, 2, 3, 4, 5]:

    slope = (n·Σ(x·y) − Σx·Σy) / (n·Σ(x²) − (Σx)²)

where y = the student's five scores in order.

### Rank Ties
When two or more students share the same average, they receive the same rank
(the highest they would have held). The next rank skips accordingly.
Example: two students tied for 2nd both get rank 2; the next student gets rank 4.

---

## Sheet 2: Test Stats
One row per test column. Columns:

| Column | Description |
|--------|-------------|
| test | Test name (test1…test5) |
| class_average | Mean score across all students for that test |
| std_dev | **Sample** standard deviation of scores for that test (ddof=1) |
| highest_score | Highest score for that test |
| lowest_score | Lowest score for that test |

---

## Sheet 3: Overall
Key–value rows:

| Key | Value |
|-----|-------|
| class_average | Mean of all student averages |
| class_median | Median of all student averages |
| grade_A+ … grade_F | Count of students in each grade bucket |
| most_improved_student | student_id with the highest slope |
| most_consistent_student | student_id with the lowest sample std dev |

---

## Implementation Notes
- Use **openpyxl** to write the Excel file.
- Use **numpy** or manual formulas for slope and std dev — do not rely on Excel
  cell formulas, compute all values in Python and write the results as values.
- Round all float outputs to 6 decimal places before writing.
- Sheet names must be exactly: `Student Stats`, `Test Stats`, `Overall`.
- The first row of each sheet must be the header row as specified above.
- The `above_class_average` column must contain Python booleans (True/False),
  not strings.
- For `most_improved_student` and `most_consistent_student`, in the event of a
  tie, use the student with the higher average as the tiebreaker.
