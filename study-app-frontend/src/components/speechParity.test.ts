import { expect, it } from "vitest";
import fixtureJson from "../../../study-app-backend/tests/fixtures/speech_parity.json";
import { markdownToSpeech, splitForSpeech } from "./episodeSpeech";

// The backend pre-generates narration for exactly the text this cleaner produces, so the Python
// port (study-app-backend/src/utils/speech_text.py) must match it. Both sides assert against this
// shared fixture; if you change the cleaner, regenerate the fixture and update the Python port.
const fixture = fixtureJson as { input: string; spoken: string; chunks: string[] }[];

it("cleans and chunks text exactly as the backend port does", () => {
  expect(fixture.length).toBeGreaterThan(0);
  for (const row of fixture) {
    const spoken = markdownToSpeech(row.input);
    expect(spoken).toBe(row.spoken);
    expect(splitForSpeech(spoken, 600)).toEqual(row.chunks);
  }
});
