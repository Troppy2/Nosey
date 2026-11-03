import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "../src/styles/base.css";
import "../src/styles/layout.css";
import "../src/styles/styles.css";
import "../src/icons/icons.css";
import { ScratchPadModal, type PaperStyle, type ScratchPadData } from "../src/components/ScratchPad";

declare global { interface Window { padData: ScratchPadData } }

function Harness() {
  const [data, setData] = useState<ScratchPadData>({ version: 1, strokes: [] });
  const [paper, setPaper] = useState<PaperStyle>("lined");
  window.padData = data;
  return (
    <ScratchPadModal questionText="Harness question" data={data} onChange={setData} paperStyle={paper} onPaperStyleChange={setPaper} onClose={() => undefined} />
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(<Harness />);
