"""Shared accuracy disclaimer for every export format.

One string, one place — JSON embeds it as a field, CSV writes it as a leading
comment line, Excel notes it on the summary sheet.
"""

DISCLAIMER = (
    "Machine-assisted takeoff. Quantities are derived from calibrated "
    "geometry and require estimator review; items with needs_review=true "
    "have unresolved evidence problems. No accuracy guarantee is made."
)
