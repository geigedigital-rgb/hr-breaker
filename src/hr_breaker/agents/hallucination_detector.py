from datetime import date

from pydantic import BaseModel, Field
from pydantic_ai import Agent

from hr_breaker.config import get_model_settings, get_settings
from hr_breaker.models import FilterResult, OptimizedResume, ResumeSource


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


SYSTEM_PROMPT = """You are a resume verification specialist. Compare an ORIGINAL resume with an OPTIMIZED version and return a no_hallucination_score from 0.0 to 1.0.

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


def get_hallucination_agent() -> Agent:
    settings = get_settings()
    agent = Agent(
        f"google-gla:{settings.gemini_pro_model}",
        output_type=HallucinationResult,
        system_prompt=SYSTEM_PROMPT,
        model_settings=get_model_settings(),
    )

    @agent.system_prompt
    def add_current_date() -> str:
        return f"Today's date: {date.today().strftime('%B %Y')}"

    return agent


async def detect_hallucinations(
    optimized: OptimizedResume,
    source: ResumeSource,
) -> FilterResult:
    """Detect hallucinations in optimized resume vs original."""
    # Use html or data depending on what's available
    if optimized.html:
        optimized_content = optimized.html
    elif optimized.data:
        optimized_content = optimized.data.model_dump_json(indent=2)
    else:
        optimized_content = "(no content)"

    prompt = f"""Compare these two resumes and score the optimized version for hallucinations.

=== ORIGINAL RESUME (source of truth, may include commented-out content which is valid) ===
{source.content}

=== OPTIMIZED RESUME (check for fabrication) ===
{optimized_content}

=== END ===

Return a no_hallucination_score (0.0-1.0) based on how faithful the optimized version is to the original.
List any concerns. Treat unsupported named tools, methods, and ATS-oriented keyword stuffing as genuine concerns, not harmless optimization."""

    agent = get_hallucination_agent()
    result = await agent.run(prompt)
    r = result.output

    issues = []
    suggestions = []

    if r.concerns:
        issues.append(f"Concerns: {', '.join(r.concerns)}")
    if r.no_hallucination_score < 0.9:
        suggestions.append(f"Score {r.no_hallucination_score:.2f} below 0.9 threshold. {r.reasoning}")

    return FilterResult(
        filter_name="HallucinationChecker",
        passed=r.no_hallucination_score >= 0.9,
        score=r.no_hallucination_score,
        issues=issues,
        suggestions=suggestions,
    )
