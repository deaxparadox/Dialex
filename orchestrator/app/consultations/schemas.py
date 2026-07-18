"""Pydantic models: the consultant's structured LLM output (used by
graphs.py via `.with_structured_output()`) and the router's request/response
shapes (spec 0009)."""

from pydantic import BaseModel, Field


class ConsultantTurnOutput(BaseModel):
    message: str
    ready_to_finalize: bool = False
    # A free-form dict field can't be expressed in OpenAI's strict
    # structured-output schema (verified empirically: it rejects any
    # object without every property enumerated and `additionalProperties:
    # false`, which is incompatible with an open-ended case payload) — so
    # the LLM emits it as a JSON-encoded string instead; graphs.py parses
    # it back into a real dict before it goes anywhere else.
    proposed_payload_json: str | None = Field(
        default=None,
        description=(
            "Only when ready_to_finalize is true: the case payload as a JSON-encoded "
            "object (a string, e.g. '{\"amount\": 50000, ...}'), not a nested object."
        ),
    )


class StartConsultationRequest(BaseModel):
    case_type: str


class StartConsultationResponse(BaseModel):
    session_id: int


class SubmitMessageRequest(BaseModel):
    text: str


class SubmitMessageResponse(BaseModel):
    message: str
    ready_to_finalize: bool


class ApproveResponse(BaseModel):
    case_id: int
    debate_id: int
