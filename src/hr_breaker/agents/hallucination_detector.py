from datetime import date

from pydantic import BaseModel, Field
from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.agents.model import gemini_model
from hr_breaker.models import FilterResult, OptimizedResume, ResumeSource

# When aggressive_tailoring (no_shame) is on, allow role-plausible stretch;
# still block fake employers, degrees, and credentials.
NO_SHAME_HALLUCINATION_THRESHOLD = 0.6


class HallucinationResult(BaseModel):
    no_hallucination_score: float = Field(
        ge=0.0,
        le=1.0,
        description="Score from 0 to 1 where 1.0 = no fabrications, 0.0 = severe fabrications",
    )
    concerns: list[str] = Field(
        default_factory=list,
        description="List of potential concerns (may include minor acceptable additions)",
    )
    reasoning: str = Field(description="Brief explanation of the score")


STRICT_PROMPT = """You are a resume verification specialist. Compare an ORIGINAL resume with an OPTIMIZED version and return a no_hallucination_score from 0.0 to 1.0.

SCORING GUIDE:
- 1.0: Perfect - all content traceable to original, only rephrasing/restructuring
- 0.95-0.99: Minor acceptable additions (careful umbrella terms that directly summarize explicit evidence)
- 0.85-0.94: Light assumptions that are reasonable, conservative, and still close to the source wording
- 0.7-0.84: Questionable additions - somewhat plausible but stretching
- 0.5-0.69: Significant fabrications - claims that may not be true
- 0.0-0.49: Severe fabrications - fake jobs, degrees, major false claims

ACCEPTABLE (score 0.95+):
- Conservative umbrella terms directly supported by the original: "NLP" for explicit text-mining/text-modeling work, "analytics" for explicit analytics work
- Rephrasing metrics: "1% - 10%" -> "1-10%", "$10k" -> "$10,000"
- Summary sections synthesizing existing experience
- Reordering, restructuring, emphasizing existing content
- Commented-out content in original (LaTeX %, HTML <!-- -->) included in optimized

LIGHT ASSUMPTIONS (score 0.85-0.94):
- Slightly broader wording that stays close to explicit source evidence
- Conservative skill generalization without introducing new named tools or methods

SERIOUS FABRICATIONS (score below 0.7):
- Fabricated job titles, companies, or employment dates
- Invented degrees, certifications, or institutions
- Made-up metrics with specific numbers not in original
- Fake achievements, publications, or awards
- Keyword stuffing to satisfy ATS
- Adding named tools, platforms, or methods that are absent from the source resume
- Turning generic adjacent experience into exact claims such as SQL, BigQuery, Tableau, Looker, A/B testing, causal inference, campaign performance, or marketing metrics without direct evidence
- Completely unrelated technologies

Be balanced: allow careful summarization, but do not excuse unsupported named tools, methods, or keyword stuffing just because they seem adjacent."""


LENIENT_PROMPT = """You are a resume verification specialist. Compare an ORIGINAL resume with an OPTIMIZED version and return a no_hallucination_score from 0.0 to 1.0.

The optimized resume was produced in aggressive tailoring mode: role-plausible reframing and conservative quantification are expected. Score accordingly — do not fail for normal ATS optimization.

SCORING GUIDE:
- 1.0: All content directly traceable to original
- 0.8-0.99: Aggressive skill extrapolations / impact wording that are plausible from context
- 0.6-0.79: Significant embellishment, creative reframing, or role-typical scale estimates
- 0.5-0.59: Very aggressive stretching but still plausible for the stated role
- 0.0-0.49: Blatant fabrications - fake jobs, degrees, made-up credentials

ACCEPTABLE (score 0.6+):
- Aggressive technology extrapolation: Python user -> common Python libraries, web dev -> full stack phrasing
- Adding plausible tools commonly paired with stated experience
- Creative reframing of responsibilities to match job language
- Inferring leadership/mentoring from senior or supervisory context
- Industry-standard practices plausible for their role
- Conservative quantified estimates that fit the role (e.g. customer volume, shift throughput) when the source describes that work without numbers
- Slightly broader safety/compliance/process wording that restates existing project aims

BLOCK (score below 0.5):
- Fabricated job titles, companies, or employment dates
- Invented degrees, certifications, or institutions
- Made-up awards, publications, or patents
- Completely fictional projects or achievements
- Technologies with zero connection to stated experience
- Wildly inflated or impossible metrics (e.g. millions of users for a student retail role)

Prefer scoring stretch claims in the 0.6-0.85 band rather than failing them. Reserve sub-0.5 for clear identity/credential fraud."""


def get_hallucination_agent(no_shame: bool = False) -> Agent:
    settings = get_settings()
    agent = Agent(
        gemini_model(settings.gemini_pro_model),
        output_type=HallucinationResult,
        system_prompt=LENIENT_PROMPT if no_shame else STRICT_PROMPT,
        model_settings=get_model_settings(),
    )

    @agent.system_prompt
    def add_current_date() -> str:
        return f"Today's date: {date.today().strftime('%B %Y')}"

    return agent


def _pass_threshold(no_shame: bool) -> float:
    if no_shame:
        return NO_SHAME_HALLUCINATION_THRESHOLD
    return get_settings().filter_hallucination_threshold


async def detect_hallucinations(
    optimized: OptimizedResume,
    source: ResumeSource,
    no_shame: bool = False,
) -> FilterResult:
    """Detect hallucinations in optimized resume vs original."""
    # Use html or data depending on what's available
    if optimized.html:
        optimized_content = optimized.html
    elif optimized.data:
        optimized_content = optimized.data.model_dump_json(indent=2)
    else:
        optimized_content = "(no content)"

    if no_shame:
        scoring_note = (
            "Aggressive tailoring is enabled: treat role-plausible reframing and "
            "conservative quantification as acceptable. Fail only clear credential/identity fraud."
        )
    else:
        scoring_note = (
            "Treat unsupported named tools, methods, and ATS-oriented keyword stuffing "
            "as genuine concerns, not harmless optimization."
        )

    prompt = f"""Compare these two resumes and score the optimized version for hallucinations.

=== ORIGINAL RESUME (source of truth, may include commented-out content which is valid) ===
{source.content}

=== OPTIMIZED RESUME (check for fabrication) ===
{optimized_content}

=== END ===

Return a no_hallucination_score (0.0-1.0) based on how faithful the optimized version is to the original.
List any concerns. {scoring_note}"""

    threshold = _pass_threshold(no_shame)
    agent = get_hallucination_agent(no_shame=no_shame)
    result = await agent.run(prompt)
    r = result.output

    issues = []
    suggestions = []

    if r.concerns:
        issues.append(f"Concerns: {', '.join(r.concerns)}")
    if r.no_hallucination_score < threshold:
        suggestions.append(
            f"Score {r.no_hallucination_score:.2f} below {threshold:.2f} threshold. {r.reasoning}"
        )

    return FilterResult(
        filter_name="HallucinationChecker",
        passed=r.no_hallucination_score >= threshold,
        score=r.no_hallucination_score,
        threshold=threshold,
        issues=issues,
        suggestions=suggestions,
    )
