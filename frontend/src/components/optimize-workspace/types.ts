import type { ReactNode } from "react";
import type { CategoryScores, WorkspaceAnnotation, JobPostingOut, ChangeDetailOut } from "../../api";

export type WorkspaceStage = "assessment" | "result";

export type OptimizeWorkspaceProps = {
  stage: WorkspaceStage;
  brandName?: string;
  profileLabel: string;
  userInitials: string;
  jobTitle: string;
  jobCompany: string;
  isImproveMode: boolean;
  matchPct: number;
  atsScore: number | null;
  categoryScores: CategoryScores | null;
  annotations: WorkspaceAnnotation[];
  job: JobPostingOut | null;
  missingKeywords: string[];
  keyChanges: ChangeDetailOut[] | null | undefined;
  shareUrl: string | null;
  /** Assessment preview (blob URL / data URL) or result PDF preview */
  paperPreviewUrl: string | null;
  /** Live template HTML body (preferred over image/text). */
  paperHtml?: string | null;
  /** Editable / readable resume text when image preview is missing (or for text edits). */
  paperText?: string | null;
  paperEditable?: boolean;
  onPaperTextChange?: (text: string) => void;
  paperFallbackName?: string;
  canImprove: boolean;
  showImproveStronger: boolean;
  improveLoading?: boolean;
  onImprove: () => void;
  onImproveStronger: () => void;
  onExport: () => void;
  onTailorAnother?: () => void;
  /** Style tab: templates + photo (result) or locked message (assessment) */
  stylePanel: ReactNode;
  /** True when user picked a template / opened Style (journey step done). */
  hasStyled?: boolean;
  onStyleVisited?: () => void;
};
