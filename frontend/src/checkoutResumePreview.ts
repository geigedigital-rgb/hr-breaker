/** Session resume preview (data URL) passed from Optimize / PostResultResumeStudio to /checkout/download-resume. */
export const CHECKOUT_RESUME_PREVIEW_STORAGE_KEY = "pitchcv_checkout_resume_preview_v1";

export function storeCheckoutResumePreview(dataUrl: string | null): void {
  try {
    if (dataUrl) sessionStorage.setItem(CHECKOUT_RESUME_PREVIEW_STORAGE_KEY, dataUrl);
    else sessionStorage.removeItem(CHECKOUT_RESUME_PREVIEW_STORAGE_KEY);
  } catch {
    /* quota or disabled storage */
  }
}

export function readCheckoutResumePreview(): string | null {
  try {
    return sessionStorage.getItem(CHECKOUT_RESUME_PREVIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}
