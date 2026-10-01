"""Shared vocabulary constants, kept in one place so `features.py` (which
encodes the `track` block) and `synthetic_profile.py` (which generates
values from this vocabulary) don't need to depend on each other."""

# The 8 career tracks already presented on the platform's landing page.
TRACKS = [
    "Data Science",
    "Software Engineering",
    "Product Design",
    "Finance",
    "Entrepreneurship",
    "Public Policy",
    "Marketing",
    "Research",
]

CADENCES = ["weekly", "biweekly", "as-needed"]
FORMATS = ["virtual", "in-person", "either"]
SUPPORT_OPTIONS = ["resume_review", "interview_prep", "networking", "general_guidance"]
