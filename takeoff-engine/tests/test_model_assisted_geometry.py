import math
from types import SimpleNamespace

import pytest
from shapely.geometry import Polygon

from app.geometry.exclusions import detect_exclusion_regions, exclusion_polygons
from app.geometry.linework import (
    detect_columns,
    detect_metadata_boxes,
    extract_parallel_wall_pairs,
    extract_wall_bodies,
    extract_wall_segments,
    filter_measurement_paths,
    floor_for_detection,
    floor_polygons_for_detection,
    polygonize_faces,
    wall_context_segments,
)
from app.pipeline.candidates import (
    _clip_exclusion_boxes_to_drawing,
    _combine_drawing_boxes,
    _dedupe_wall_candidates,
    _final_drawing_filter,
    _floor_label_faces,
    _new_work_drawing_boxes,
    _normalize_wall_candidates,
    _oversized_wall_face_exclusions,
    _trade_drawing_boxes,
    _vector_door_detections,
    _wall_code_points,
)
from app.pipeline.orchestrator import _nearest_wall_code
from app.schemas.core import VectorPath
from app.schemas.detection import DetectedObject
from app.schemas.ocr import OCRSpan


def vp(points, *, dashes=None, color="#000000", kind="stroke"):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return VectorPath(
        sheet_id="s1",
        kind=kind,
        points=[points],
        is_closed=points[0] == points[-1],
        color=color,
        dashes=dashes or [],
        bbox=(min(xs), min(ys), max(xs), max(ys)),
    )


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]


def circle(cx, cy, r, n=24):
    pts = [
        (cx + math.cos(i * math.tau / n) * r, cy + math.sin(i * math.tau / n) * r)
        for i in range(n)
    ]
    return pts + [pts[0]]


def arc(cx, cy, r, start_deg, end_deg, n=12):
    start = math.radians(start_deg)
    end = math.radians(end_deg)
    return [
        (cx + math.cos(start + (end - start) * i / (n - 1)) * r, cy + math.sin(start + (end - start) * i / (n - 1)) * r)
        for i in range(n)
    ]


def slanted_rect(cx, cy, length, thickness, angle_deg):
    angle = math.radians(angle_deg)
    ux, uy = math.cos(angle), math.sin(angle)
    nx, ny = -uy, ux
    hl = length / 2
    ht = thickness / 2
    pts = [
        (cx - ux * hl - nx * ht, cy - uy * hl - ny * ht),
        (cx + ux * hl - nx * ht, cy + uy * hl - ny * ht),
        (cx + ux * hl + nx * ht, cy + uy * hl + ny * ht),
        (cx - ux * hl + nx * ht, cy - uy * hl + ny * ht),
    ]
    return pts + [pts[0]]


def test_door_symbol_count_keeps_per_mark_audit_counts():
    from app.pipeline.measure import count_symbols
    from app.schemas.core import Sheet
    from app.schemas.scale import ScaleCalibration, ScaleSource

    sheet = Sheet(project_id="p1", source_file="test.pdf", page_number=1)
    scale = ScaleCalibration(sheet_id=sheet.id, source=ScaleSource.MANUAL, ft_per_pt=1.0, confidence=0.99)
    detections = [
        DetectedObject(sheet_id=sheet.id, label="door", bbox=(0, 0, 10, 10), confidence=0.9, detector="test", schedule_ref="100A"),
        DetectedObject(sheet_id=sheet.id, label="door", bbox=(20, 0, 30, 10), confidence=0.8, detector="test", schedule_ref="100A"),
        DetectedObject(sheet_id=sheet.id, label="door", bbox=(40, 0, 50, 10), confidence=0.7, detector="test", schedule_ref="101"),
        DetectedObject(sheet_id=sheet.id, label="door", bbox=(60, 0, 70, 10), confidence=0.7, detector="test"),
        DetectedObject(sheet_id=sheet.id, label="door", bbox=(80, 0, 90, 10), confidence=0.1, detector="test", schedule_ref="LOW"),
        DetectedObject(sheet_id=sheet.id, label="door", bbox=(105, 105, 115, 115), confidence=0.8, detector="test", schedule_ref="ETR"),
    ]

    item = count_symbols(
        project_id="p1",
        sheet=sheet,
        detections=detections,
        label="door",
        scale=scale,
        min_confidence=0.3,
        exclude_polygons=[Polygon([(100, 100), (120, 100), (120, 120), (100, 120)])],
    )

    assert item is not None
    assert item.quantity == 4.0
    assert item.description == "Doors (symbol count)"
    assert item.attributes["count_basis"] == "accepted_symbols"
    assert item.attributes["symbol_count"] == 4
    assert item.attributes["marks"] == ["100A", "101"]
    assert item.attributes["mark_counts"] == {"100A": 2, "101": 1}
    assert item.attributes["unique_mark_count"] == 2
    assert item.attributes["unmatched_symbol_count"] == 1


def test_grouped_wall_quantities_keep_segment_audit_trail():
    from app.pipeline.orchestrator import _group_wall_items
    from app.schemas.quantity import QuantityItem

    walls = [
        QuantityItem(
            project_id="p1",
            sheet_id="s1",
            page_number=1,
            item_type="wall",
            description="Wall S2-0-6",
            quantity=12.34,
            unit="LF",
            formula="LF = first",
            source_geometry_ids=["g1"],
            attributes={"wall_code": "S2-0-6"},
        ),
        QuantityItem(
            project_id="p1",
            sheet_id="s1",
            page_number=1,
            item_type="wall",
            description="Wall S2-0-6",
            quantity=5.0,
            unit="LF",
            formula="LF = second",
            source_geometry_ids=["g2"],
            attributes={"wall_code": "S2-0-6"},
        ),
    ]

    grouped = _group_wall_items(walls, "s1")

    assert len(grouped) == 1
    wall = grouped[0]
    assert wall.quantity == 17.34
    assert wall.source_geometry_ids == ["g1", "g2"]
    assert wall.attributes["segment_count"] == 2
    assert wall.attributes["segment_lengths_lf"] == [12.34, 5.0]
    assert wall.formula == "LF = sum of 2 wall segments for S2-0-6 = 17.34"


def test_grouped_wall_quantities_round_only_after_summing_raw_lengths():
    from app.pipeline.orchestrator import _group_wall_items
    from app.schemas.quantity import QuantityItem

    walls = [
        QuantityItem(
            project_id="p1",
            sheet_id="s1",
            page_number=1,
            item_type="wall",
            description="Wall S1-0-3",
            quantity=2.67,
            unit="LF",
            formula="segment",
            attributes={"wall_code": "S1-0-3", "raw_quantity_lf": 8 / 3},
        )
        for _ in range(3)
    ]

    wall = _group_wall_items(walls, "s1")[0]

    assert wall.quantity == 8.0
    assert wall.attributes["segment_lengths_lf"] == [2.67, 2.67, 2.67]
    assert wall.attributes["raw_quantity_lf"] == pytest.approx(8.0)


def test_semantic_exclusions_are_optional_and_filter_side_blocks_when_detected():
    plan_wall = vp([(10, 10), (90, 10)])
    title_block_line = vp([(130, 10), (180, 10)])

    assert filter_measurement_paths([plan_wall, title_block_line]) == [plan_wall, title_block_line]

    kept = filter_measurement_paths(
        [plan_wall, title_block_line],
        drawing_boxes=[(0, 0, 200, 100)],
        exclusion_boxes=[(120, 0, 200, 100)],
    )
    assert kept == [plan_wall]


def test_dotted_lines_do_not_split_floor_polygonization():
    outer = vp(rect(0, 0, 100, 100))
    dotted_split = vp([(50, 0), (50, 100)], dashes=[3, 3])

    faces = polygonize_faces(filter_measurement_paths([outer, dotted_split]), min_area_pt2=100)

    assert len(faces) == 1
    assert faces[0].area == pytest.approx(10_000)


def test_wall_segments_include_horizontal_vertical_and_slanted_but_not_columns():
    paths = [
        vp([(0, 0), (80, 0)]),
        vp([(0, 0), (0, 80)]),
        vp([(10, 90), (90, 130)]),
        vp(rect(30, 30, 50, 50)),
    ]
    columns = detect_columns(paths)

    segments = extract_wall_segments(paths, exclude_polygons=[poly for _, poly in columns], min_length_pt=10)

    assert len(segments) == 3
    assert [(0, 0), (80, 0)] in segments
    assert [(0, 0), (0, 80)] in segments
    assert [(10, 90), (90, 130)] in segments


def test_wall_bodies_are_rectangles_and_ignore_guides_hatches_and_metadata():
    wall = vp(rect(10, 10, 110, 18))
    perpendicular = vp(rect(10, 18, 18, 90))
    guide = vp([(10, 35), (110, 35)])
    hatch = vp([(40, 45), (65, 70)])
    title_cell = vp(rect(150, 10, 260, 28))
    spans = [
        OCRSpan(sheet_id="s1", text="PAPER TYPE A8.11", bbox=(162, 12, 245, 24), confidence=1.0),
    ]
    metadata_boxes = detect_metadata_boxes([wall, perpendicular, guide, hatch, title_cell], spans)
    measurement = filter_measurement_paths(
        [wall, perpendicular, guide, hatch, title_cell],
        exclusion_boxes=metadata_boxes,
    )

    bodies = extract_wall_bodies(measurement, min_length_pt=20)

    assert len(bodies) == 2
    assert sorted(round(length) for _, length in bodies) == [72, 100]
    assert all(poly.area > 0 for poly, _ in bodies)


def test_wall_body_with_tiny_cad_notch_is_normalized_to_exact_rectangle():
    notched = vp([
        (10, 10),
        (110, 10),
        (110, 18),
        (72, 18),
        (72, 17.5),
        (69, 18),
        (10, 18),
        (10, 10),
    ])

    bodies = _normalize_wall_candidates(extract_wall_bodies([notched], min_length_pt=20))

    assert len(bodies) == 1
    poly, length = bodies[0]
    assert length == pytest.approx(100)
    assert poly.area == pytest.approx(poly.minimum_rotated_rectangle.area)
    assert len(list(poly.exterior.coords)) == 5


def test_wall_candidate_dedupe_removes_nested_parallel_outline_not_perpendicular_return():
    long_wall = Polygon(rect(0, 0, 8, 100))
    nested_outline = Polygon(rect(6.5, 20, 11, 80))
    perpendicular_return = Polygon(rect(8, 80, 60, 88))

    kept = _dedupe_wall_candidates([
        (long_wall, 100),
        (nested_outline, 60),
        (perpendicular_return, 52),
    ])

    assert {length for _, length in kept} == {100, 52}


def test_oversized_wall_face_becomes_fixture_exclusion():
    oversized_casework = Polygon(rect(0, 0, 30, 200))
    scheduled_wall = Polygon(rect(35, 0, 43, 200))

    exclusions = _oversized_wall_face_exclusions(
        [oversized_casework, scheduled_wall],
        exclude_polygons=[],
        text_boxes=[],
        code_points=[],
        context_segments=[],
        max_wall_thickness_pt=20,
    )

    assert exclusions == [oversized_casework]


def test_metadata_detection_does_not_treat_boxed_plan_tags_as_side_panels():
    room_tag = vp(rect(100, 500, 130, 530))
    title_cell = vp(rect(660, 520, 780, 600))
    spans = [
        OCRSpan(sheet_id="s1", text="C2", bbox=(109, 509, 121, 521), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A1.00", bbox=(690, 560, 730, 575), confidence=1.0),
        OCRSpan(sheet_id="s1", text="PAPER TYPE A8.11", bbox=(670, 535, 755, 548), confidence=1.0),
    ]

    metadata_boxes = detect_metadata_boxes([room_tag, title_cell], spans)

    assert room_tag.bbox not in metadata_boxes
    assert title_cell.bbox in metadata_boxes


def test_metadata_detection_ignores_in_plan_transition_detail_boxes():
    in_plan_detail = vp(rect(1950, 1450, 2320, 1580))
    right_title_block = vp(rect(2710, 1750, 2960, 2120))
    spans = [
        OCRSpan(sheet_id="s1", text="A1 / A8.00", bbox=(2070, 1500, 2140, 1520), confidence=1.0),
        OCRSpan(sheet_id="s1", text="TRANSITION DETAIL", bbox=(2060, 1530, 2180, 1550), confidence=1.0),
        OCRSpan(sheet_id="s1", text="SHEET TITLE", bbox=(2720, 1820, 2810, 1840), confidence=1.0),
        OCRSpan(sheet_id="s1", text="FINISH PLAN", bbox=(2720, 1860, 2880, 1900), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A8.10", bbox=(2720, 1980, 2900, 2070), confidence=1.0),
    ]

    metadata_boxes = detect_metadata_boxes([in_plan_detail, right_title_block], spans)

    assert in_plan_detail.bbox not in metadata_boxes
    assert right_title_block.bbox in metadata_boxes


def test_combined_demo_construction_sheet_prefers_construction_work_region():
    spans = [
        OCRSpan(sheet_id="s1", text="CONSTRUCTION PLAN", bbox=(830, 300, 945, 320), confidence=1.0),
        OCRSpan(sheet_id="s1", text="DEMOLITION PLAN", bbox=(780, 980, 950, 1008), confidence=1.0),
        OCRSpan(sheet_id="s1", text="CONSTRUCTION PLAN", bbox=(780, 1970, 990, 1998), confidence=1.0),
        OCRSpan(sheet_id="s1", text="DEMOLITION & CONSTRUCTION FLOOR PLANS", bbox=(2710, 1840, 2910, 1935), confidence=1.0),
        OCRSpan(sheet_id="s1", text="SHEET TITLE", bbox=(2710, 1820, 2810, 1840), confidence=1.0),
    ]

    boxes = _new_work_drawing_boxes(spans, 3000, 2160)

    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert 450 <= x0 <= 520
    assert 2650 <= x1 <= 2700
    assert 1050 <= y0 <= 1120
    assert 1900 <= y1 <= 1970


def test_wall_code_points_are_limited_to_active_drawing_region():
    spans = [
        OCRSpan(sheet_id="s1", text="S2-0-6", bbox=(40, 40, 80, 55), confidence=1.0),
        OCRSpan(sheet_id="s1", text="S1-0-4", bbox=(40, 210, 80, 225), confidence=1.0),
        OCRSpan(sheet_id="s1", text="S1-0-3", bbox=(250, 210, 290, 225), confidence=1.0),
    ]

    points = _wall_code_points(
        spans,
        exclusion_boxes=[(220, 190, 310, 240)],
        drawing_boxes=[(0, 180, 200, 260)],
    )

    assert points == [((40 + 80) / 2, (210 + 225) / 2)]


def test_construction_work_region_excludes_left_legend_wall_code_like_tokens():
    spans = [
        OCRSpan(sheet_id="s1", text="DEMOLITION PLAN", bbox=(780, 980, 950, 1008), confidence=1.0),
        OCRSpan(sheet_id="s1", text="CONSTRUCTION PLAN", bbox=(780, 1970, 990, 1998), confidence=1.0),
        OCRSpan(sheet_id="s1", text="SHEET TITLE", bbox=(2710, 1820, 2810, 1840), confidence=1.0),
        OCRSpan(sheet_id="s1", text="C1-1-6", bbox=(140, 1180, 180, 1198), confidence=1.0),
        OCRSpan(sheet_id="s1", text="S2-0-6", bbox=(850, 1490, 890, 1508), confidence=1.0),
    ]
    boxes = _new_work_drawing_boxes(spans, 3000, 2160)

    points = _wall_code_points(spans, exclusion_boxes=[], drawing_boxes=boxes)

    assert points == [((850 + 890) / 2, (1490 + 1508) / 2)]


def test_vector_door_detection_uses_marks_and_ignores_legend_or_detail_arcs():
    real_door = vp(arc(100, 100, 32, 0, 90))
    legend_arc = vp(arc(20, 100, 32, 0, 90))
    detail_bubble = vp(circle(190, 100, 18), kind="stroke")
    spans = [
        OCRSpan(sheet_id="s1", text="101A", bbox=(122, 92, 146, 105), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A3", bbox=(184, 94, 196, 106), confidence=1.0),
    ]

    detections = _vector_door_detections(
        sheet_id="s1",
        vector_paths=[real_door, legend_arc, detail_bubble],
        spans=spans,
        drawing_boxes=[(0, 0, 240, 200)],
        excluded_polys=[],
    )

    assert len(detections) == 1
    assert detections[0].label == "door"
    assert detections[0].schedule_ref == "101A"


def test_vector_door_detection_extends_only_to_scheduled_exterior_marks_not_detail_bubbles():
    exterior_arc = vp(arc(60, 60, 40, 0, 90))
    detail_arc = vp(arc(300, 60, 40, 0, 90))
    spans = [
        OCRSpan(sheet_id="s1", text="100A", bbox=(170, 154, 198, 170), confidence=1.0),
        OCRSpan(sheet_id="s1", text="105D", bbox=(395, 154, 423, 170), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A7.11", bbox=(312, 74, 340, 90), confidence=1.0),
    ]

    detections = _vector_door_detections(
        sheet_id="s1",
        vector_paths=[exterior_arc, detail_arc],
        spans=spans,
        drawing_boxes=[(0, 0, 500, 180)],
        excluded_polys=[],
    )

    assert len(detections) == 1
    assert detections[0].schedule_ref == "100A"


def test_deterministic_work_region_narrows_broad_model_drawing_box():
    boxes = _combine_drawing_boxes(
        semantic_boxes=[(0, 0, 300, 300)],
        deterministic_boxes=[(0, 150, 300, 260)],
    )

    assert boxes == [(0, 150, 300, 260)]


def test_tiny_model_drawing_box_cannot_starve_deterministic_work_region():
    boxes = _combine_drawing_boxes(
        semantic_boxes=[(250, 180, 290, 215)],
        deterministic_boxes=[(0, 150, 300, 260)],
    )

    assert boxes == [(0, 150, 300, 260)]


def test_flooring_scope_prefers_finish_plan_view_on_reflected_ceiling_sheet():
    spans = [
        OCRSpan(sheet_id="s1", text="REFLECTED CEILING PLAN", bbox=(740, 1030, 990, 1055), confidence=1.0),
        OCRSpan(sheet_id="s1", text="FINISH PLAN", bbox=(780, 1970, 900, 1997), confidence=1.0),
        OCRSpan(sheet_id="s1", text="FINISH PLAN AND REFLECTED CEILING PLAN", bbox=(2710, 1840, 2910, 1935), confidence=1.0),
        OCRSpan(sheet_id="s1", text="SHEET TITLE", bbox=(2710, 1820, 2810, 1840), confidence=1.0),
    ]

    boxes = _trade_drawing_boxes(spans, 3000, 2160, {"flooring"})

    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert 430 <= x0 <= 480
    assert 2650 <= x1 <= 2700
    assert 1100 <= y0 <= 1140
    assert 1940 <= y1 <= 1970


def test_final_drawing_filter_removes_area_detections_outside_selected_view():
    inside = DetectedObject(sheet_id="s1", label="floor_area", bbox=(50, 150, 90, 190), confidence=0.8, detector="test")
    outside = DetectedObject(sheet_id="s1", label="floor_area", bbox=(50, 10, 90, 50), confidence=0.8, detector="test")
    excluded = DetectedObject(sheet_id="s1", label="door", bbox=(150, 150, 190, 190), confidence=0.8, detector="test")
    drawing = DetectedObject(sheet_id="s1", label="drawing_area", bbox=(0, 100, 200, 220), confidence=0.8, detector="test")

    kept = _final_drawing_filter(
        [inside, outside, excluded, drawing],
        drawing_boxes=[(0, 100, 200, 220)],
        exclusion_boxes=[(130, 130, 200, 200)],
    )

    assert kept == [inside, drawing]


def test_metadata_exclusion_boxes_are_clipped_outside_active_drawing():
    clipped = _clip_exclusion_boxes_to_drawing(
        exclusion_boxes=[(50, 0, 700, 2000), (2600, 0, 3000, 2000)],
        drawing_boxes=[(500, 1000, 2600, 1900)],
    )

    assert (50, 0, 500, 2000) in clipped
    assert (2600, 0, 3000, 2000) in clipped
    assert all(not (500 < (box[0] + box[2]) / 2 < 2600 and 1000 < (box[1] + box[3]) / 2 < 1900) for box in clipped)


def test_diagonal_hatch_clusters_do_not_become_slanted_walls():
    slanted_wall = vp(slanted_rect(60, 40, 80, 8, 35))
    hatch_cluster = [
        vp(slanted_rect(145 + i * 8, 42 + i * 8, 48, 6, 45))
        for i in range(5)
    ]
    paths = [slanted_wall, *hatch_cluster]

    bodies = extract_wall_bodies(
        paths,
        context_segments=wall_context_segments(paths),
        min_length_pt=20,
    )

    assert len(bodies) == 1
    assert bodies[0][0].bounds == pytest.approx(slanted_wall.bbox)


def test_parallel_outline_walls_become_single_rectangles():
    top = vp([(10, 10), (110, 10)])
    bottom = vp([(10, 18), (110, 18)])
    guide = vp([(10, 40), (110, 40)])

    pairs = extract_parallel_wall_pairs(
        [top, bottom, guide],
        text_boxes=[],
        context_segments=wall_context_segments([top, bottom, guide]),
    )

    assert len(pairs) == 1
    assert pairs[0][0].bounds == pytest.approx((10, 10, 110, 18))
    assert pairs[0][1] == pytest.approx(100)


def test_gray_stroke_existing_walls_are_excluded_from_wall_pairs():
    new_top = vp([(10, 10), (110, 10)], color="#000000")
    new_bottom = vp([(10, 18), (110, 18)], color="#000000")
    existing_top = vp([(10, 50), (110, 50)], color="#808080")
    existing_top.stroke_width = 0.8
    existing_bottom = vp([(10, 58), (110, 58)], color="#808080")
    existing_bottom.stroke_width = 0.8
    paths = [new_top, new_bottom, existing_top, existing_bottom]
    exclusions = exclusion_polygons(
        detect_exclusion_regions(sheet_id="s1", vector_paths=paths, spans=[], faces=[])
    )

    pairs = extract_parallel_wall_pairs(
        paths,
        exclude_polygons=exclusions,
        context_segments=wall_context_segments(paths),
    )

    assert len(pairs) == 1
    assert pairs[0][0].bounds == pytest.approx((10, 10, 110, 18))


def test_gray_linework_is_not_used_as_wall_pair_context():
    black_top = vp([(10, 10), (110, 10)], color="#000000")
    black_bottom = vp([(10, 18), (110, 18)], color="#000000")
    gray_top = vp([(10, 50), (110, 50)], color="#808080")
    gray_bottom = vp([(10, 58), (110, 58)], color="#808080")

    context = wall_context_segments(
        [black_top, black_bottom, gray_top, gray_bottom],
        include_gray=False,
    )
    pairs = extract_parallel_wall_pairs(
        [black_top, black_bottom, gray_top, gray_bottom],
        context_segments=context,
    )

    assert len(context) == 2
    assert len(pairs) == 1
    assert pairs[0][0].bounds == pytest.approx((10, 10, 110, 18))


def test_wall_code_matching_uses_same_reach_as_candidate_extraction():
    geom = SimpleNamespace(kind="polygon", exterior=rect(0, 0, 100, 8))
    spans = [
        OCRSpan(sheet_id="s1", text="S2-0-6", bbox=(35, 86, 70, 100), confidence=1.0),
    ]

    hit = _nearest_wall_code(spans, geom)

    assert hit is not None
    assert hit[0] == "S2-0-6"


def test_detects_square_and_round_columns():
    columns = detect_columns([vp(rect(10, 10, 25, 25)), vp(circle(70, 70, 9))])

    assert sorted(shape for shape, _ in columns) == ["round", "square"]
    assert all(isinstance(poly, Polygon) and poly.area > 0 for _, poly in columns)


def test_column_detection_ignores_compact_text_callouts():
    text_box = Polygon(rect(8, 8, 27, 27))
    columns = detect_columns(
        [vp(rect(10, 10, 25, 25)), vp(circle(70, 70, 9))],
        text_boxes=[text_box],
    )

    assert len(columns) == 1
    assert columns[0][0] == "round"


def test_floor_area_unions_faces_and_subtracts_columns_as_holes():
    paths = [
        vp(rect(0, 0, 200, 100)),
        vp(rect(40, 35, 60, 55)),
        vp(circle(130, 50, 10)),
    ]
    faces = polygonize_faces(paths, min_area_pt2=100)
    columns = detect_columns(paths)
    column_polys = [poly for _, poly in columns]

    floor = floor_for_detection(faces, (0, 0, 200, 100), column_polys)

    assert floor is not None
    assert len(floor.interiors) == 2
    assert floor.area == pytest.approx(20_000 - sum(poly.area for poly in column_polys))


def test_floor_polygons_keep_disconnected_floor_parts():
    left = Polygon(rect(0, 0, 100, 100))
    right = Polygon(rect(120, 0, 220, 100))

    parts = floor_polygons_for_detection([left, right], (0, 0, 220, 100))

    assert len(parts) == 2
    assert sum(p.area for p in parts) == pytest.approx(20_000)


def test_floor_label_faces_anchor_finish_overlay_to_labeled_rooms():
    foyer = Polygon(rect(0, 0, 100, 100))
    shared_bath = Polygon(rect(120, 0, 220, 100))
    unlabeled_storage = Polygon(rect(240, 0, 340, 100))
    spans = [
        OCRSpan(sheet_id="s1", text="330 SF", bbox=(35, 35, 70, 50), confidence=1.0),
        OCRSpan(sheet_id="s1", text="30 SF", bbox=(145, 30, 175, 45), confidence=1.0),
        OCRSpan(sheet_id="s1", text="58 SF", bbox=(175, 55, 205, 70), confidence=1.0),
        OCRSpan(sheet_id="s1", text="ETR", bbox=(270, 35, 295, 50), confidence=1.0),
    ]

    faces = _floor_label_faces(
        [foyer, shared_bath, unlabeled_storage],
        (0, 0, 360, 120),
        spans,
    )

    assert len(faces) == 2
    assert foyer in faces
    assert shared_bath in faces
    assert unlabeled_storage not in faces


def test_etr_text_prefers_gray_region_over_broad_connected_face():
    broad_face = Polygon(rect(0, 0, 500, 300))
    gray_region = vp(rect(20, 20, 160, 120), color="#b0b0b0", kind="fill")
    span = OCRSpan(sheet_id="s1", text="ETR", bbox=(80, 65, 105, 82), confidence=1.0)

    exclusions = detect_exclusion_regions(
        sheet_id="s1",
        vector_paths=[gray_region],
        spans=[span],
        faces=[broad_face],
    )

    etr = [e for e in exclusions if e.reason == "etr_text"]
    assert len(etr) == 1
    assert etr[0].bbox == pytest.approx(gray_region.bbox)


def test_etr_text_does_not_exclude_huge_open_face_without_local_region():
    broad_face = Polygon(rect(0, 0, 900, 500))
    span = OCRSpan(sheet_id="s1", text="ETR", bbox=(420, 240, 445, 257), confidence=1.0)

    exclusions = detect_exclusion_regions(
        sheet_id="s1",
        vector_paths=[],
        spans=[span],
        faces=[broad_face],
    )

    etr = [e for e in exclusions if e.reason == "etr_text"]
    assert len(etr) == 1
    assert (etr[0].bbox[2] - etr[0].bbox[0]) < 200
    assert (etr[0].bbox[3] - etr[0].bbox[1]) < 140


def test_etr_in_mixed_gray_region_localizes_when_room_sf_label_is_present():
    etr_face = Polygon(rect(40, 60, 130, 140))
    labeled_face = Polygon(rect(300, 100, 430, 190))
    gray_region = vp(rect(0, 0, 500, 300), color="#b0b0b0", kind="fill")
    spans = [
        OCRSpan(sheet_id="s1", text="ETR", bbox=(60, 80, 84, 96), confidence=1.0),
        OCRSpan(sheet_id="s1", text="175 SF", bbox=(360, 130, 400, 146), confidence=1.0),
    ]

    exclusions = detect_exclusion_regions(
        sheet_id="s1",
        vector_paths=[gray_region],
        spans=spans,
        faces=[etr_face, labeled_face],
    )

    etr = [e for e in exclusions if e.reason == "etr_text"]
    assert len(etr) == 1
    assert (etr[0].bbox[2] - etr[0].bbox[0]) < 200
    assert (etr[0].bbox[3] - etr[0].bbox[1]) < 140
    gray = [Polygon(e.exterior, e.holes) for e in exclusions if e.reason == "gray_fill"]
    assert gray
    assert not any(poly.contains(labeled_face.representative_point()) for poly in gray)


def test_finish_hatch_without_etr_is_not_an_exclusion():
    face = Polygon(rect(0, 0, 100, 50))
    hatch = [
        vp([(x, 48), (x + 30, 2)], color="#000000")
        for x in range(5, 70, 8)
    ]

    exclusions = detect_exclusion_regions(
        sheet_id="s1",
        vector_paths=hatch,
        spans=[],
        faces=[face],
        exclude_black_hatch=False,
    )

    assert [e for e in exclusions if e.reason == "hatch_fill"] == []


def test_gray_hatch_without_text_is_an_exclusion():
    face = Polygon(rect(0, 0, 100, 50))
    hatch = [
        vp([(x, 48), (x + 30, 2)], color="#a8a8a8")
        for x in range(5, 70, 8)
    ]

    exclusions = detect_exclusion_regions(
        sheet_id="s1",
        vector_paths=hatch,
        spans=[],
        faces=[face],
    )

    assert any(e.reason == "hatch_fill" for e in exclusions)
