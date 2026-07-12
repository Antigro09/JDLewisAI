import type { TakeoffReport } from "@/lib/tools/material-takeoff";

export type EngineProjectStatus = "created" | "processing" | "processed" | "failed" | string;
export type EngineJobStatus = "queued" | "running" | "done" | "failed";
export type ReviewAction = "accept" | "edit" | "reject";
export type TakeoffTrade = "walls" | "doors" | "flooring" | "columns";

export type TakeoffScopeRequest = {
  trade: TakeoffTrade;
  sheet_refs: string[];
  sheet_ids: string[];
  include_existing: boolean;
};

export type TakeoffScope = {
  instructions: string;
  requests: TakeoffScopeRequest[];
};

export type EngineProject = {
  id: string;
  name: string;
  status: EngineProjectStatus;
  created_at?: string;
  files?: { id: string; filename: string; media_type: string }[];
};

export type EngineUpload = {
  id: string;
  storage_path: string;
  media_type: string;
};

export type EngineJob = {
  id: string;
  project_id: string;
  kind: string;
  status: EngineJobStatus;
  progress?: string;
  error?: string;
  created_at?: string;
  finished_at?: string | null;
};

export type EngineSheet = {
  id: string;
  project_id?: string;
  page_number: number;
  sheet_number?: string;
  sheet_title?: string;
  sheet_type?: string;
  width_pt?: number;
  height_pt?: number;
  rotation_deg?: number;
  render_dpi?: number;
  [key: string]: unknown;
};

export type PagePoint = [number, number];

export type OverlayStyle = {
  stroke?: string;
  fill?: string;
  stroke_width?: number;
  dash?: string;
};

export type OverlaySegment = {
  p1: PagePoint;
  p2: PagePoint;
  label: string;
};

export type EngineOverlayFeature = {
  quantity_id: string;
  item_type: string;
  description: string;
  quantity: number;
  unit: string;
  formula: string;
  needs_review: boolean;
  review_status: string;
  review_reason?: string[];
  final_confidence?: number;
  style?: OverlayStyle;
  polygons?: PagePoint[][];
  holes?: PagePoint[][][];
  boxes?: [number, number, number, number][];
  /** Wall centerline endpoints with preformatted length labels (page points). */
  segments?: OverlaySegment[];
};

export type EngineOverlay = {
  sheet_id: string;
  width_pt: number;
  height_pt: number;
  scale?: { ft_per_pt?: number; source?: string; [key: string]: unknown } | null;
  features: EngineOverlayFeature[];
};

export type EngineQuantity = {
  id: string;
  project_id: string;
  sheet_id: string;
  page_number: number;
  item_type: string;
  description: string;
  quantity: number;
  unit: string;
  formula: string;
  csi_code?: string | null;
  source_geometry_ids?: string[];
  source_ocr_span_ids?: string[];
  scale_id?: string | null;
  scale_confidence?: number;
  measurement_confidence?: number;
  model_confidence?: number;
  final_confidence?: number;
  needs_review: boolean;
  review_reason?: string[];
  review_status: "pending" | "accepted" | "edited" | "rejected" | string;
  overlay_style?: OverlayStyle;
  attributes?: Record<string, unknown>;
  version?: number;
  created_at?: string;
};

export type ReviewRequest = {
  action: ReviewAction;
  corrected_quantity?: number | null;
  corrected_unit?: string | null;
  corrected_description?: string | null;
  corrected_geometry?: PagePoint[] | null;
  comment?: string;
};

export type EngineCorrection = {
  id: string;
  quantity_item_id: string;
  action: ReviewAction;
  created_at?: string;
  reviewer?: string;
  comment?: string;
  corrected_quantity?: number | null;
  corrected_unit?: string | null;
  corrected_description?: string | null;
  corrected_geometry?: PagePoint[] | null;
  machine_snapshot?: Partial<EngineQuantity>;
};

export type BridgeResponse = {
  report: TakeoffReport;
  includedQuantityIds: string[];
  sheetLink?: string;
};
