import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { PhotoIcon, TrashIcon } from "@heroicons/react/24/outline";
import * as api from "../../api";
import { t } from "../../i18n";

async function cropFileToSquarePreview(file: File, maxEdge = 400): Promise<string> {
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image load failed"));
      el.src = blobUrl;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = Math.floor((img.naturalWidth - side) / 2);
    const sy = Math.floor((img.naturalHeight - side) / 2);
    const canvas = document.createElement("canvas");
    const out = Math.min(side, maxEdge);
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function StylePanel({
  locked,
  selectedTemplateId,
  photoDataUrl,
  onTemplateChange,
  onPhotoChange,
}: {
  locked?: boolean;
  selectedTemplateId: string;
  photoDataUrl: string | null;
  onTemplateChange: (id: string) => void;
  onPhotoChange: (url: string | null) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<api.AdminTemplateListItem[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (locked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getTemplates();
        if (cancelled) return;
        const items = api.sortResumeTemplatesForUi(res.items);
        setTemplates(items);
        if (items.length && !selectedTemplateId) {
          onTemplateChange(items[0].id);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locked]);

  if (locked) {
    return <p className="text-[12px] leading-relaxed text-[#94A3B8]">{t("optimize.workspace.styleAfterImprove")}</p>;
  }

  async function handlePhotoInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await cropFileToSquarePreview(file);
      onPhotoChange(url);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-[#0f172a]">{t("optimize.addPhoto")}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-14 w-14 overflow-hidden rounded-xl border border-[#E8ECF4] bg-[#F8FAFC]">
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[#CBD5E1]">
                <PhotoIcon className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void handlePhotoInput(e)}
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="rounded-lg border border-[#4578FC] px-2.5 py-1 text-[12px] font-semibold text-[#4578FC]"
            >
              {photoDataUrl ? t("optimize.changePhoto") : t("optimize.uploadPhoto")}
            </button>
            {photoDataUrl && (
              <button
                type="button"
                onClick={() => onPhotoChange(null)}
                className="inline-flex items-center gap-1 text-[11px] text-[#64748B]"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                {t("optimize.removePhoto")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="text-[13px] font-semibold text-[#0f172a]">{t("optimize.chooseTemplate")}</p>
        {loadError && (
          <p className="mt-1 text-[11px] text-amber-700">{t("optimize.templatesUnavailable")}</p>
        )}
        <div className="mt-2 max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
          {templates.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => onTemplateChange(tmpl.id)}
              className={`flex w-full items-center rounded-xl border px-3 py-2 text-left text-[12px] font-semibold transition ${
                selectedTemplateId === tmpl.id
                  ? "border-[#4578FC] bg-[#EEF2FF] text-[#4578FC]"
                  : "border-[#E8ECF4] bg-white text-[#334155] hover:bg-[#F8FAFC]"
              }`}
            >
              {tmpl.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
