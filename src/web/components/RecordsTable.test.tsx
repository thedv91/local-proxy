import "../test-dom";
import { afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { DEFAULT_OPTIONS } from "../../records/schema";
import type { RecordView } from "../api";
import { RecordsTable } from "./RecordsTable";

// Testing Library unmounts automatically only when test globals exist; bun:test has none.
afterEach(cleanup);

const record: RecordView = {
  id: "1",
  source: "https://api.example.com/v1",
  domain: "api-car.localhost",
  enabled: true,
  port: 41234,
  listening: true,
  error: null,
  options: {
    ...DEFAULT_OPTIONS,
    extraHeaders: [
      { name: "X-Api-Key", value: "secret" },
      { name: "X-Tenant", value: "car" },
    ],
    skipTlsVerify: true,
  },
};

function renderTable(records: RecordView[]) {
  return render(
    <RecordsTable records={records} onToggle={() => {}} onEdit={() => {}} onDelete={() => {}} />,
  );
}

test("renders a badge for each active option", () => {
  const { getAllByRole } = renderTable([record]);
  const [row] = getAllByRole("row").slice(1);
  const badges = within(row as HTMLElement)
    .getAllByRole("listitem")
    .map((badge) => badge.textContent);
  expect(badges).toEqual([
    "CORS reflect",
    "No Origin/Referer",
    "+2 headers",
    "Cookie rewrite",
    "Location rewrite",
    "30s timeout",
    "TLS verify off",
  ]);
});

test("flags skipped TLS verification as a warning", () => {
  const { getByText } = renderTable([record]);
  expect(getByText("TLS verify off").className).toContain("text-red-800");
});

test("shows the domain, listener port, enable state and alias errors", () => {
  const { getByText, getByRole } = renderTable([
    {
      ...record,
      enabled: false,
      listening: false,
      error: "api-car.localhost is already a portless alias",
    },
  ]);
  expect(getByRole("link", { name: "api-car.localhost" })).toHaveProperty(
    "href",
    "https://api-car.localhost/",
  );
  const toggle = getByRole("switch", { name: "Enable api-car.localhost" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(getByText("api-car.localhost is already a portless alias")).toBeTruthy();
});
