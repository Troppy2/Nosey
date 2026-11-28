import { expect, it } from "vitest";

import { statementAllowsAnyOrder } from "./pyodideRunner";

it("reads 'in any order' from a statement, through tags and spaces", () => {
  expect(statementAllowsAnyOrder("<p>You can return the answer in <strong>any order</strong>.</p>")).toBe(true);
  expect(statementAllowsAnyOrder("<p>Return the subsets&nbsp;in any order.</p>")).toBe(true);
  expect(statementAllowsAnyOrder("<p>Return the sorted array.</p>")).toBe(false);
  expect(statementAllowsAnyOrder(undefined)).toBe(false);
});
