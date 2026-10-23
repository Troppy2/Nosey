import json
from pathlib import Path

from src.utils.speech_text import markdown_to_speech, split_for_speech

FIXTURE = Path(__file__).parent / "fixtures" / "speech_parity.json"


def test_port_matches_the_frontend_cleaner():
    # tests/fixtures/speech_parity.json is produced by the TypeScript cleaner in
    # study-app-frontend/src/components/episodeSpeech.ts and asserted there too.
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert rows
    for row in rows:
        spoken = markdown_to_speech(row["input"])
        assert spoken == row["spoken"]
        assert split_for_speech(spoken, 600) == row["chunks"]
