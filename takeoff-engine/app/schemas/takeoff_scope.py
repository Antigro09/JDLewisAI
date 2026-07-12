from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

TakeoffTrade = Literal["walls", "doors", "flooring", "columns"]


def _norm_ref(value: str) -> str:
    return value.upper().replace(" ", "").replace("-", ".")


class TakeoffScopeRequest(BaseModel):
    trade: TakeoffTrade
    sheet_refs: list[str] = Field(default_factory=list)
    sheet_ids: list[str] = Field(default_factory=list)
    include_existing: bool = False


class TakeoffScope(BaseModel):
    instructions: str = ""
    requests: list[TakeoffScopeRequest] = Field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.requests

    def trades_for_sheet(self, *, sheet_id: str, sheet_number: str = "", page_number: int = 0) -> set[TakeoffTrade]:
        if not self.requests:
            return {"walls", "doors", "flooring", "columns"}
        refs = {
            _norm_ref(sheet_number),
            f"PAGE{page_number}",
            str(page_number),
        }
        trades: set[TakeoffTrade] = set()
        for request in self.requests:
            request_ids = set(request.sheet_ids)
            request_refs = {_norm_ref(r) for r in request.sheet_refs}
            if not request_ids and not request_refs:
                trades.add(request.trade)
                continue
            if sheet_id in request_ids or refs.intersection(request_refs):
                trades.add(request.trade)
        return trades

    def include_existing_for_sheet(self, *, sheet_id: str, sheet_number: str = "", page_number: int = 0) -> bool:
        if not self.requests:
            return False
        refs = {
            _norm_ref(sheet_number),
            f"PAGE{page_number}",
            str(page_number),
        }
        for request in self.requests:
            if not request.include_existing:
                continue
            request_ids = set(request.sheet_ids)
            request_refs = {_norm_ref(r) for r in request.sheet_refs}
            if not request_ids and not request_refs:
                return True
            if sheet_id in request_ids or refs.intersection(request_refs):
                return True
        return False


def scope_from_payload(payload: dict | None) -> TakeoffScope:
    if not payload:
        return TakeoffScope()
    return TakeoffScope.model_validate(payload)
