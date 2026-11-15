import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownContent, repairMatrixRows } from "./MarkdownContent";

// Backslashes are built from char codes so no tool can unescape them.
const BS = String.fromCharCode(92);
const ROW = BS + BS;
const matrix = (...rows: string[]) => `${BS}begin{bmatrix} ${rows.join(` ${ROW} `)} ${BS}end{bmatrix}`;
const broken = `${BS}begin{bmatrix} 4 & 2 ${BS} 5 & 2 ${BS} 6 & 2 ${BS}end{bmatrix}`;

afterEach(cleanup);

describe("repairMatrixRows", () => {
  it("restores row breaks that lost a backslash inside a matrix", () => {
    expect(repairMatrixRows(broken)).toBe(matrix("4 & 2", "5 & 2", "6 & 2"));
  });

  it("leaves a correct matrix and text outside matrices alone", () => {
    expect(repairMatrixRows(matrix("1 & 2", "3 & 4"))).toBe(matrix("1 & 2", "3 & 4"));
    expect(repairMatrixRows(`a${BS} b`)).toBe(`a${BS} b`);
  });

  it("renders a stored broken matrix with three rows", () => {
    const { container } = render(<MarkdownContent content={`$A = ${broken}$`} />);
    // KaTeX lays each matrix row out as its own vlist row in every column.
    const firstColumn = container.querySelector(".katex .mtable .col-align-c");
    // KaTeX pads the column with a zero-width space.
    expect(firstColumn?.textContent?.split(String.fromCharCode(0x200b)).join("")).toBe("456");
  });
});
