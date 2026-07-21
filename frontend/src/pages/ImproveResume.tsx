import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CloudArrowUpIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";
import { displayFilename, resumeLabel } from "../utils/filenames";

const RESUME_FILE_ACCEPT = ".txt,.md,.html,.htm,.tex,.pdf,.doc,.docx";
const RESUME_EXTS = ["txt", "md", "html", "htm", "tex", "pdf", "doc", "docx"];

type Mode = "improve" | "tailor" | null;

async function readFileContent(
  file: File,
  user: ReturnType<typeof useAuth>["user"],
  refreshUser: ReturnType<typeof useAuth>["refreshUser"],
): Promise<{ content: string; fileName: string; originalFileName: string; sourceWasPdf: boolean }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const originalFileName = file.name;
  if (ext === "pdf") {
    const res = await api.parseResumePdf(file);
    const content = res.content ?? "";
    let fileName = originalFileName;
    if (user) {
      const upRes = await api.registerResumeUpload(file);
      fileName = upRes.filename;
      await refreshUser();
    }
    return { content, fileName, originalFileName, sourceWasPdf: true };
  }
  if (ext === "docx" || ext === "doc") {
    const res = await api.parseResumeDocx(file);
    return { content: res.content ?? "", fileName: originalFileName, originalFileName, sourceWasPdf: false };
  }
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error(t("improveResume.readFileError")));
    reader.readAsText(file, "UTF-8");
  });
  return { content, fileName: originalFileName, originalFileName, sourceWasPdf: false };
}

export default function ImproveResume() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const landingClaimRef = useRef<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [resumeContent, setResumeContent] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [sourceWasPdf, setSourceWasPdf] = useState(false);
  const [uploadedDisplayName, setUploadedDisplayName] = useState<string>("");
  const [selectedMode, setSelectedMode] = useState<Mode>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!RESUME_EXTS.includes(ext)) return;
    setUploading(true);
    try {
      const { content, fileName, originalFileName, sourceWasPdf: wasPdf } = await readFileContent(
        file,
        user,
        refreshUser,
      );
      setResumeContent(content);
      setUploadedFileName(fileName);
      setSourceWasPdf(wasPdf);
      setUploadedDisplayName(originalFileName);
      setSelectedMode(null);
      setJobDescription("");
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleImproveClick = () => {
    if (!resumeContent) return;
    navigate("/optimize", {
      state: {
        resumeContent,
        uploadedFileName,
        originalFileName: uploadedDisplayName,
        sourceWasPdf,
        improveMode: true,
      },
    });
  };

  const handleTailorCardClick = () => {
    if (!resumeContent) return;
    setSelectedMode((prev) => (prev === "tailor" ? null : "tailor"));
  };

  const handleTailorSubmit = () => {
    if (!resumeContent) return;
    navigate("/optimize", {
      state: {
        resumeContent,
        uploadedFileName,
        originalFileName: uploadedDisplayName,
        sourceWasPdf,
        jobInputPreset: jobDescription.trim(),
        autoStart: true,
      },
    });
  };

  // Claim landing upload: /improve?pending=TOKEN (after login from marketing site)
  const pendingTok = searchParams.get("pending");
  useEffect(() => {
    if (!pendingTok || !user || user.id === "local") return;
    if (landingClaimRef.current === pendingTok) return;
    landingClaimRef.current = pendingTok;
    setUploading(true);
    api
      .claimLandingPending(pendingTok)
      .then((data) => {
        setResumeContent(data.resume_content);
        setUploadedFileName(data.resume_filename);
        setSourceWasPdf((data.resume_filename || "").toLowerCase().endsWith(".pdf"));
        setUploadedDisplayName(resumeLabel(data.original_filename, data.resume_filename, "Resume"));
        setSelectedMode(null);
        setJobDescription("");
        setSearchParams({}, { replace: true });
      })
      .catch(() => {
        landingClaimRef.current = null;
      })
      .finally(() => setUploading(false));
  }, [pendingTok, user, setSearchParams]);

  // Pre-load resume when navigated from Home → "Improve" or Optimize after landing claim (no job)
  useEffect(() => {
    const state = location.state as {
      resumeContent?: string;
      uploadedFileName?: string;
      originalFileName?: string;
      sourceWasPdf?: boolean;
    } | null;
    if (state?.resumeContent) {
      setResumeContent(state.resumeContent);
      setUploadedFileName(state.uploadedFileName ?? null);
      setSourceWasPdf(state.sourceWasPdf ?? false);
      setUploadedDisplayName(resumeLabel(state.originalFileName, state.uploadedFileName, "Resume"));
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const hasJob = jobDescription.trim().length > 0;
  const shownName = displayFilename(uploadedDisplayName || "Resume");

  return (
    <div className="ds-page-stage">
    <div className="ds-page-stage-body max-w-2xl mx-auto space-y-5">
      {/* Upload zone — shown while no file yet */}
      {!resumeContent ? (
        <>
        <h1 className="text-xl font-bold text-[var(--text)] text-center tracking-tight">
          {t("improveResume.uploadSectionHeading")}
        </h1>
        <div
          className={`rounded-2xl border-2 border-dashed transition-colors cursor-pointer ${
            isDragging
              ? "border-[var(--accent)] bg-[#EEF1FC]"
              : "border-[#c8cddc] bg-white hover:border-[var(--accent)]/50 hover:bg-[var(--accent-soft)]"
          } ${uploading ? "opacity-60 pointer-events-none" : ""}`}
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          aria-label={t("improveResume.uploadTitle")}
        >
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
            {uploading ? (
              <>
                <span
                  className="w-10 h-10 border-2 border-[var(--accent)]/30 border-t-[#4578FC] rounded-full animate-spin"
                  aria-hidden
                />
                <p className="text-sm font-medium text-[var(--accent)]">{t("improveResume.uploading")}</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-[#EEF1FC] flex items-center justify-center">
                  <CloudArrowUpIcon className="w-7 h-7 text-[var(--accent)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{t("improveResume.uploadTitle")}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{t("improveResume.uploadHint")}</p>
                </div>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={RESUME_FILE_ACCEPT}
            className="hidden"
            onChange={handleInputChange}
            aria-label={t("improveResume.uploadTitle")}
          />
        </div>
        </>
      ) : (
        /* Uploaded indicator */
        <div className="flex items-center gap-3 ds-card px-4 py-3">
          <img
            src="/media/pdf-icon.svg"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 object-contain"
            decoding="async"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--text)] truncate" title={uploadedDisplayName || undefined}>
              {shownName}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{t("improveResume.uploadedLabel")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setResumeContent(null);
              setUploadedFileName(null);
              setUploadedDisplayName("");
              setSelectedMode(null);
              setJobDescription("");
            }}
            className="text-xs font-medium text-[var(--accent)] hover:underline shrink-0"
          >
            {t("improveResume.changeResume")}
          </button>
        </div>
      )}

      {/* Title + mode cards — shown only after upload */}
      {resumeContent && (
        <div className="space-y-5">
          <h1 className="text-xl font-bold text-[var(--text)] text-center">{t("improveResume.pageTitle")}</h1>
        </div>
      )}

      {resumeContent && (
        <div className="space-y-3">
          {/* Card 1: Improve my resume */}
          <button
            type="button"
            onClick={handleImproveClick}
            className="w-full text-left ds-card p-5 flex items-center gap-4 hover:border-[var(--accent)]/40 hover:shadow-sm transition-all group"
          >
            <div className="shrink-0 w-16 h-16 flex items-center justify-center">
              <img src="/IR.svg" alt="" className="w-full h-full object-contain" draggable={false} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                  {t("improveResume.improveTitle")}
                </span>
                <span className="text-[11px] font-medium text-[var(--text)]/60 border border-[#c8cddc] rounded-full px-2 py-0.5">
                  {t("improveResume.improveTag")}
                </span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1 leading-snug">
                {t("improveResume.improveDesc")}
              </p>
            </div>
          </button>

          {/* Card 2: Tailor to a job */}
          <div
            className={`rounded-2xl border bg-white transition-all overflow-hidden ${
              selectedMode === "tailor"
                ? "border-[var(--accent)]/40 shadow-sm"
                : "border-[var(--border)] hover:border-[var(--accent)]/30 hover:shadow-sm"
            }`}
          >
            <button
              type="button"
              onClick={handleTailorCardClick}
              className="w-full text-left p-5 flex items-center gap-4 group"
            >
              <div className="shrink-0 w-16 h-16 flex items-center justify-center">
                <img src="/TJ.svg" alt="" className="w-full h-full object-contain" draggable={false} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-base font-semibold transition-colors ${
                      selectedMode === "tailor" ? "text-[var(--accent)]" : "text-[var(--text)] group-hover:text-[var(--accent)]"
                    }`}
                  >
                    {t("improveResume.tailorTitle")}
                  </span>
                  <span className="text-[11px] font-medium text-[var(--text)]/60 border border-[#c8cddc] rounded-full px-2 py-0.5">
                    {t("improveResume.tailorTag")}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-1 leading-snug">
                  {t("improveResume.tailorDesc")}
                </p>
              </div>
            </button>

            {/* Expandable job description field */}
            {selectedMode === "tailor" && (
              <div className="px-5 pb-5 space-y-3">
                <div className="h-px bg-[#EBEDF5]" />
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder={t("improveResume.jobPlaceholder")}
                  rows={5}
                  className="w-full rounded-xl border border-[var(--border)] bg-[#F5F6FA] px-4 py-3 text-sm text-[var(--text)] placeholder:text-[#9aa3b8] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-colors"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleTailorSubmit}
                  disabled={!hasJob}
                  className="ds-btn-primary w-full flex items-center justify-center gap-2 !h-11 !rounded-xl !text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("improveResume.tailorBtn")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
