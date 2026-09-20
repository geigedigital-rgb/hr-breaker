import { useEffect, useMemo, useState } from "react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { AnnotationRail, sortAnnotationsByPriority } from "./AnnotationRail";
import { ResumePaperStage } from "./ResumePaperStage";
import { NextStepCard } from "./NextStepCard";
import { InsightTabs } from "./InsightTabs";
import { WorkspaceJourneyBar, type JourneyStepId } from "./WorkspaceJourneyBar";
import type { OptimizeWorkspaceProps } from "./types";
import { t } from "../../i18n";

export function OptimizeWorkspace(props: OptimizeWorkspaceProps) {
  const {
    stage,
    brandName = t("optimize.workspace.brandName"),
    profileLabel,
    userInitials,
    jobTitle,
    jobCompany,
    isImproveMode,
    matchPct,
    atsScore,
    categoryScores,
    annotations,
    job,
    missingKeywords,
    keyChanges,
    shareUrl,
    paperPreviewUrl,
    paperHtml,
    paperText,
    paperEditable = true,
    onPaperTextChange,
    paperFallbackName,
    canImprove,
    showImproveStronger,
    improveLoading,
    onImprove,
    onImproveStronger,
    onExport,
    onTailorAnother,
    stylePanel,
    hasStyled = false,
    onStyleVisited,
  } = props;

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [insightTab, setInsightTab] = useState<"match" | "job" | "style">("match");

  const orderedAnnotations = useMemo(
    () => sortAnnotationsByPriority(annotations),
    [annotations],
  );

  useEffect(() => {
    if (insightTab === "style") onStyleVisited?.();
  }, [insightTab, onStyleVisited]);

  /** Only warnings + suggestions — not positive tips or key_changes. */
  const improvementCount = useMemo(
    () => orderedAnnotations.filter((a) => a.severity !== "positive").length,
    [orderedAnnotations],
  );

  const primaryLabel =
    stage === "result" && showImproveStronger
      ? t("optimize.workspace.improveStronger")
      : t("optimize.workspace.improveResume");

  const canPrimary = stage === "assessment" ? canImprove : showImproveStronger;
  const onPrimary = stage === "assessment" ? onImprove : onImproveStronger;
  const actionsEnabled = stage === "result";

  const hasRecommendations = orderedAnnotations.length > 0;
  const hasImproved = stage === "result";

  function focusFirst() {
    const firstAttention =
      orderedAnnotations.find((a) => a.severity === "warning") ||
      orderedAnnotations.find((a) => a.severity !== "positive") ||
      orderedAnnotations[0];
    if (firstAttention) setFocusedId(firstAttention.id);
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  function handleJourneyStep(id: JourneyStepId) {
    if (id === "recommendations") {
      focusFirst();
      setInsightTab("match");
      return;
    }
    if (id === "improve") {
      if (stage === "assessment" && canImprove) {
        onImprove();
        return;
      }
      if (stage === "result" && showImproveStronger) {
        onImproveStronger();
        return;
      }
      setInsightTab("match");
      return;
    }
    if (id === "style") {
      setInsightTab("style");
      onStyleVisited?.();
      // Scroll right column into view on mobile
      document.querySelector(".optimize-ws-insights")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  return (
    <div className="optimize-workspace relative flex w-full min-w-0 flex-col gap-3 pb-20">
      {toast && (
        <div
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[#E8ECF4] bg-white px-4 py-2 text-[13px] font-medium text-[#0f172a] shadow-lg"
          role="status"
        >
          {toast}
        </div>
      )}

      <WorkspaceHeader
        brandName={brandName}
        profileLabel={profileLabel}
        userInitials={userInitials}
        jobTitle={jobTitle}
        jobCompany={jobCompany}
        isImproveMode={isImproveMode}
        matchPct={matchPct}
        shareUrl={shareUrl}
        actionsEnabled={actionsEnabled}
        onExport={onExport}
        onShareFeedback={showToast}
      />

      <div className="optimize-ws-grid grid w-full min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="optimize-ws-stage relative order-2 lg:order-1 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <aside className="order-2 lg:order-1 min-w-0 self-start">
            <AnnotationRail
              annotations={orderedAnnotations}
              focusedId={focusedId}
              onFocus={setFocusedId}
            />
          </aside>

          <div className="order-1 lg:order-2 min-w-0 min-h-[420px] lg:min-h-[560px] self-start">
            <ResumePaperStage
              previewUrl={paperPreviewUrl}
              paperHtml={paperHtml}
              paperText={paperText}
              paperEditable={paperEditable}
              onPaperTextChange={onPaperTextChange}
              fallbackName={paperFallbackName}
              annotations={orderedAnnotations}
              focusedId={focusedId}
              onFocusAnnotation={setFocusedId}
              onExport={() => {
                if (!actionsEnabled) {
                  showToast(t("optimize.workspace.actionsLocked"));
                  return;
                }
                onExport();
              }}
            />
          </div>
        </div>

        <aside className="optimize-ws-insights order-1 lg:order-2 flex min-w-0 flex-col gap-3 self-start">
          {(stage === "assessment" || showImproveStronger) && (
            <NextStepCard
              improvementCount={improvementCount}
              primaryLabel={primaryLabel}
              canPrimary={canPrimary}
              loading={improveLoading}
              onPrimary={onPrimary}
              onReviewOneByOne={focusFirst}
              secondaryLabel={stage === "result" && onTailorAnother ? t("optimize.workspace.tailorAnother") : undefined}
              onSecondary={onTailorAnother}
            />
          )}
          {stage === "result" && !showImproveStronger && (
            <NextStepCard
              improvementCount={improvementCount}
              primaryLabel={t("optimize.workspace.exportResume")}
              canPrimary
              onPrimary={onExport}
              onReviewOneByOne={focusFirst}
              secondaryLabel={onTailorAnother ? t("optimize.workspace.tailorAnother") : undefined}
              onSecondary={onTailorAnother}
            />
          )}
          <InsightTabs
            atsScore={atsScore}
            categoryScores={categoryScores}
            job={job}
            isImproveMode={isImproveMode}
            missingKeywords={missingKeywords}
            keyChanges={keyChanges}
            stylePanel={stylePanel}
            tab={insightTab}
            onTabChange={setInsightTab}
          />
        </aside>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-3">
        <WorkspaceJourneyBar
          hasRecommendations={hasRecommendations}
          hasImproved={hasImproved}
          hasStyled={hasStyled}
          onStepClick={handleJourneyStep}
        />
      </div>
    </div>
  );
}

export type { OptimizeWorkspaceProps } from "./types";
