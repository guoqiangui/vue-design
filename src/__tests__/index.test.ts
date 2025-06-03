import { expect, test } from "vitest";
import { getSequence } from "../utils";

test("getSequence", () => {
  const seq = getSequence([2, 3, 1, -1]);
  expect(seq).toEqual([0, 1]);

  const seq2 = getSequence([10, 30, 100, 200, 300, 50, 60]);
  expect(seq2).toEqual([0, 1, 2, 3, 4]);

  const seq3 = getSequence([10, 9, 2, 5, 3, 7, 101, 18]);
  expect([
    [2, 4, 5, 6],
    [2, 4, 5, 7],
  ]).toContainEqual(seq3);
});
