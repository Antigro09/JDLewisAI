"""Train a lightweight sheet-type classifier — PRIORITY 3 (optional).

Replaces the keyword heuristics in app/pipeline/sheet_classify.py with a model
learned from OCR text. Deliberately lightweight: TF-IDF over each sheet's OCR
spans → logistic regression. No GPU, trains in seconds, and it consumes exactly
the OCR spans the pipeline already produces. A small ViT on thumbnails is the
heavier alternative, but this is enough to beat hand-tuned keywords.

Labels come from the review workflow: as estimators correct misclassified
sheets, the sheet_type on SheetRow becomes ground truth. You can also seed a CSV
of <sheet_id,sheet_type>.

Install:  pip install scikit-learn joblib
Run:      python training/train_sheet_classifier.py \
              --output checkpoints/sheet_classifier.joblib
          # optional: --labels-csv labels.csv  (columns: sheet_id,sheet_type)
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from pathlib import Path

from sqlalchemy import select

from app.db.database import get_engine, session_scope
from app.db.orm import ArtifactRow, SheetRow


def load_examples(session, labels_csv: Path | None) -> tuple[list[str], list[str]]:
    """Returns (ocr_text_per_sheet, sheet_type_label) aligned lists."""
    override: dict[str, str] = {}
    if labels_csv and labels_csv.exists():
        with open(labels_csv) as f:
            for row in csv.DictReader(f):
                override[row["sheet_id"]] = row["sheet_type"]

    # OCR text per sheet.
    text_by_sheet: dict[str, list[str]] = {}
    for art in session.execute(select(ArtifactRow).where(ArtifactRow.kind == "ocr_span")).scalars():
        text_by_sheet.setdefault(art.sheet_id, []).append(art.data.get("text", ""))

    texts, labels = [], []
    for sheet in session.execute(select(SheetRow)).scalars():
        label = override.get(sheet.id, sheet.sheet_type)
        if not label or label == "unknown":
            continue  # only labeled sheets train the model
        spans = text_by_sheet.get(sheet.id, [])
        if not spans:
            continue
        texts.append(" ".join(spans))
        labels.append(label)
    return texts, labels


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", type=Path, default=Path("checkpoints/sheet_classifier.joblib"))
    ap.add_argument("--labels-csv", type=Path, default=None)
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args()

    try:
        import joblib
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import classification_report
        from sklearn.model_selection import train_test_split
        from sklearn.pipeline import Pipeline
    except ImportError as e:
        raise SystemExit("Install: pip install scikit-learn joblib") from e

    if args.database_url:
        get_engine(args.database_url)
    with session_scope() as session:
        texts, labels = load_examples(session, args.labels_csv)

    dist = Counter(labels)
    print(f"examples: {len(texts)}  classes: {dict(dist)}")
    if len(texts) < 15 or len(dist) < 2:
        raise SystemExit("Need >=15 labeled sheets across >=2 sheet types. Classify and correct "
                         "more sheets in the review UI (or supply --labels-csv), then re-run.")

    # Stratify only when every class has >=2 examples.
    stratify = labels if all(v >= 2 for v in dist.values()) else None
    x_tr, x_te, y_tr, y_te = train_test_split(
        texts, labels, test_size=0.2, random_state=0, stratify=stratify
    )

    clf = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)),
        ("lr", LogisticRegression(max_iter=1000, class_weight="balanced")),
    ])
    clf.fit(x_tr, y_tr)
    print("\nHeld-out performance:")
    print(classification_report(y_te, clf.predict(x_te), zero_division=0))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, args.output)
    print(f"Saved → {args.output.resolve()}")
    print("\nPlug in: in app/pipeline/sheet_classify.py, load this with joblib and, when its top "
          "probability clears a threshold, use its label instead of the keyword vote (keep the "
          "keyword path as the fallback).")


if __name__ == "__main__":
    main()
