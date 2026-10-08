"""Shared seat display status for the portal and exported reports."""

from .models import Seat


def display_state(seat: Seat, *, occupied: bool, pending: bool) -> str:
    if seat.is_archived or seat.admin_status != "active":
        return "unavailable"
    if occupied:
        return "occupied"
    if pending:
        return "pending"
    return "available"
