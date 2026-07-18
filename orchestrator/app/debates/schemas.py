"""Pydantic models: structured LLM output schemas (used by graphs.py via
`.with_structured_output()`) and the start-endpoint's request/response
shapes."""

from pydantic import BaseModel, Field


class ArgumentOutput(BaseModel):
    content: str
    position: str
    confidence: float = Field(ge=0.0, le=1.0)
    responds_to_argument_id: int | None = Field(
        default=None,
        description=(
            "Required (non-null) when this position differs from this participant's "
            "own position last round — decision 4's citation-on-change rule."
        ),
    )


class JudgeOpeningOutput(BaseModel):
    opening_statement: str


class JudgeClosingOutput(BaseModel):
    decision: str
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    closing_summary: str
    cited_argument_ids: list[int]


class StartDebateResponse(BaseModel):
    workflow_id: str
    run_id: str
