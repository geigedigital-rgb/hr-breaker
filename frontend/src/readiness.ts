/** Custom star image per level (lvl1 = Emerging, lvl2 = Structured, …). */
export const READINESS_STAGE_ICON_IMAGE: Partial<Record<string, string>> = {
  Emerging: "/assets/star-lvl1.png",
  Structured: "/assets/star-lvl2.png",
  Competitive: "/assets/star-lvl3.png",
  Strong: "/assets/star-lvl4.png",
  "Interview-Ready": "/assets/star-lvl5.png",
};

/** Stage labels and order for Market Readiness (match backend READINESS_STAGES). */
export const READINESS_STAGE_LABEL: Record<string, string> = {
  Emerging: "Начинающий кандидат",
  Structured: "Осознанный кандидат",
  Competitive: "Конкурентный кандидат",
  Strong: "Сильный кандидат",
  "Interview-Ready": "Приоритетный кандидат",
};

export const READINESS_STAGE_ORDER = ["Emerging", "Structured", "Competitive", "Strong", "Interview-Ready"] as const;

/** One-line meaning of each stage (for ladder "signature line"). */
export const READINESS_STAGE_MEANING: Record<string, string> = {
  Emerging: "Профиль только формируется",
  Structured: "Структура и ключевые формулировки на месте",
  Competitive: "Профиль читается и выглядит уверенно",
  Strong: "Больше доказуемых результатов",
  "Interview-Ready": "Готовность к приоритетному рассмотрению",
};

const STAR_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'/%3E%3C/svg%3E\")";

export const READINESS_STAGE_ICON_STYLE: Record<string, Record<string, string>> = {
  Emerging: {
    background: "#9ca3af",
    WebkitMaskImage: STAR_MASK,
    maskImage: STAR_MASK,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
  },
  Structured: {
    background: "#c4b5fd",
    WebkitMaskImage: STAR_MASK,
    maskImage: STAR_MASK,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
  },
  Competitive: {
    background: "linear-gradient(135deg, #a78bfa 0%, #c084fc 100%)",
    WebkitMaskImage: STAR_MASK,
    maskImage: STAR_MASK,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
  },
  Strong: {
    background: "linear-gradient(135deg, #a855f7 0%, #c084fc 50%, #ec4899 100%)",
    WebkitMaskImage: STAR_MASK,
    maskImage: STAR_MASK,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
  },
  "Interview-Ready": {
    background: "linear-gradient(135deg, #a855f7 0%, #c084fc 40%, #ec4899 100%)",
    WebkitMaskImage: STAR_MASK,
    maskImage: STAR_MASK,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
  },
};

/** Hero gradient background (light, from sidebar block). */
export const READINESS_HERO_GRADIENT =
  "linear-gradient(135deg, rgba(233, 213, 255, 0.5) 0%, rgba(216, 180, 254, 0.35) 40%, rgba(196, 181, 253, 0.25) 70%, rgba(232, 121, 249, 0.3) 100%)";
